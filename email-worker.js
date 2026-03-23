/**
 * mfer.one Email Worker — Cloudflare KV-backed email system.
 *
 * No tunnel, no home PC, no single point of failure.
 *
 * Inbound:
 *   email() handler receives all @mfer.one mail via Cloudflare Email Routing,
 *   parses it, and stores to KV keyed by recipient + messageId.
 *
 * API:
 *   fetch() handler exposes REST endpoints for agents to read their inbox.
 *   Auth: X-Api-Key header must match EMAIL_API_KEY secret.
 *
 * KV Schema:
 *   inbox:{localPart}:{messageId}  →  full email JSON
 *   inbox:{localPart}:index        →  array of { messageId, from, subject, timestamp, read }
 *
 * Deploy: npx wrangler deploy -c wrangler-email.toml
 */

// Max email body size to process (256KB)
const MAX_BODY_SIZE = 256 * 1024;

// Max number of lines to keep from body
const MAX_BODY_LINES = 500;

// Max emails per inbox
const MAX_INBOX_SIZE = 100;

// CORS headers for API responses
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

export default {
  // ─── Incoming Email Handler ──────────────────────────────
  async email(message, env, ctx) {
    const from = message.from;
    const to = message.to;
    const subject = message.headers.get('subject') || '(no subject)';
    const messageId = message.headers.get('message-id') || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const inReplyTo = message.headers.get('in-reply-to') || null;
    const references = message.headers.get('references') || null;
    const date = message.headers.get('date') || new Date().toISOString();

    // Extract the local part (agent name) from the recipient address
    const localPart = to.split('@')[0].toLowerCase();

    console.log(`[email] Incoming: ${from} -> ${to} (${localPart}) Subject: "${subject}"`);

    // Read the raw email body
    let rawBody = '';
    try {
      const reader = message.raw.getReader();
      const decoder = new TextDecoder();
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.length;
        if (totalSize > MAX_BODY_SIZE) {
          rawBody += decoder.decode(value, { stream: true });
          rawBody = rawBody.slice(0, MAX_BODY_SIZE);
          break;
        }
        rawBody += decoder.decode(value, { stream: true });
      }
    } catch (err) {
      console.log(`[email] Error reading body: ${err.message}`);
      rawBody = '(error reading email body)';
    }

    // Parse the email body — extract text content from raw MIME
    let body = extractTextBody(rawBody);

    // Truncate body lines
    const lines = body.split('\n');
    if (lines.length > MAX_BODY_LINES) {
      body = lines.slice(0, MAX_BODY_LINES).join('\n') + '\n\n[... truncated]';
    }

    const timestamp = new Date().toISOString();

    // Sanitize messageId for use as KV key (remove angle brackets, slashes)
    const safeMessageId = messageId.replace(/[<>\/\\]/g, '_').slice(0, 200);

    // Full email data
    const emailData = {
      messageId: safeMessageId,
      from,
      to,
      localPart,
      subject,
      body,
      timestamp,
      inReplyTo,
      references,
      date,
      read: false,
    };

    // Index entry (no body — keeps index small)
    const indexEntry = {
      messageId: safeMessageId,
      from,
      subject,
      timestamp,
      read: false,
    };

    try {
      // Store full email
      await env.EMAIL_KV.put(
        `inbox:${localPart}:${safeMessageId}`,
        JSON.stringify(emailData),
        { expirationTtl: 60 * 60 * 24 * 90 } // 90 day TTL
      );

      // Update index
      const indexKey = `inbox:${localPart}:index`;
      let index = [];
      const existing = await env.EMAIL_KV.get(indexKey);
      if (existing) {
        try { index = JSON.parse(existing); } catch {}
      }

      // Add new entry at the beginning (newest first)
      index.unshift(indexEntry);

      // Cap at MAX_INBOX_SIZE — remove oldest
      while (index.length > MAX_INBOX_SIZE) {
        const removed = index.pop();
        // Delete the old email from KV
        await env.EMAIL_KV.delete(`inbox:${localPart}:${removed.messageId}`);
      }

      await env.EMAIL_KV.put(indexKey, JSON.stringify(index));

      console.log(`[email] Stored to KV: inbox:${localPart}:${safeMessageId}`);
    } catch (err) {
      console.log(`[email] KV store error: ${err.message}`);
    }

    // Forward to fallback email as backup
    const fallbackEmail = env.FALLBACK_EMAIL;
    if (fallbackEmail) {
      try {
        await message.forward(fallbackEmail);
        console.log(`[email] Forwarded to fallback`);
      } catch (err) {
        console.log(`[email] Forward failed: ${err.message}`);
      }
    }
  },

  // ─── HTTP API Handler ────────────────────────────────────
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Health check — no auth needed
    if (path === '/' || path === '/health') {
      return json({ status: 'ok', service: 'mfer-one-email' });
    }

    // Auth check for all /inbox routes
    const apiKey = request.headers.get('X-Api-Key');
    if (!apiKey || apiKey !== env.EMAIL_API_KEY) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // Route: GET /inbox/:name — list emails
    const listMatch = path.match(/^\/inbox\/([a-zA-Z0-9._-]+)$/);
    if (listMatch && request.method === 'GET') {
      const name = listMatch[1].toLowerCase();
      return await handleListInbox(name, url, env);
    }

    // Route: GET /inbox/:name/unread — unread count
    const unreadMatch = path.match(/^\/inbox\/([a-zA-Z0-9._-]+)\/unread$/);
    if (unreadMatch && request.method === 'GET') {
      const name = unreadMatch[1].toLowerCase();
      return await handleUnreadCount(name, env);
    }

    // Route: GET /inbox/:name/:messageId — read specific email
    const readMatch = path.match(/^\/inbox\/([a-zA-Z0-9._-]+)\/([^/]+)$/);
    if (readMatch && request.method === 'GET') {
      const name = readMatch[1].toLowerCase();
      const messageId = decodeURIComponent(readMatch[2]);
      return await handleReadEmail(name, messageId, env);
    }

    // Route: POST /inbox/:name/:messageId/read — mark as read
    const markReadMatch = path.match(/^\/inbox\/([a-zA-Z0-9._-]+)\/([^/]+)\/read$/);
    if (markReadMatch && request.method === 'POST') {
      const name = markReadMatch[1].toLowerCase();
      const messageId = decodeURIComponent(markReadMatch[2]);
      return await handleMarkRead(name, messageId, env);
    }

    // Route: DELETE /inbox/:name/:messageId — delete email
    const deleteMatch = path.match(/^\/inbox\/([a-zA-Z0-9._-]+)\/([^/]+)$/);
    if (deleteMatch && request.method === 'DELETE') {
      const name = deleteMatch[1].toLowerCase();
      const messageId = decodeURIComponent(deleteMatch[2]);
      return await handleDeleteEmail(name, messageId, env);
    }

    return json({ error: 'Not found' }, 404);
  },
};

// ─── API Handlers ────────────────────────────────────────

async function handleListInbox(name, url, env) {
  const indexKey = `inbox:${name}:index`;
  const raw = await env.EMAIL_KV.get(indexKey);
  if (!raw) {
    return json({ name, emails: [], total: 0 });
  }

  let index = [];
  try { index = JSON.parse(raw); } catch {}

  // Optional filters via query params
  const unreadOnly = url.searchParams.get('unread') === 'true';
  const fromFilter = url.searchParams.get('from');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  let results = index;

  if (unreadOnly) {
    results = results.filter(e => !e.read);
  }
  if (fromFilter) {
    const f = fromFilter.toLowerCase();
    results = results.filter(e => e.from.toLowerCase().includes(f));
  }

  const total = results.length;
  results = results.slice(offset, offset + limit);

  return json({ name, emails: results, total, offset, limit });
}

async function handleUnreadCount(name, env) {
  const indexKey = `inbox:${name}:index`;
  const raw = await env.EMAIL_KV.get(indexKey);
  if (!raw) {
    return json({ name, unread: 0 });
  }

  let index = [];
  try { index = JSON.parse(raw); } catch {}

  const unread = index.filter(e => !e.read).length;
  return json({ name, unread });
}

async function handleReadEmail(name, messageId, env) {
  const key = `inbox:${name}:${messageId}`;
  const raw = await env.EMAIL_KV.get(key);
  if (!raw) {
    return json({ error: 'Email not found' }, 404);
  }

  let email;
  try { email = JSON.parse(raw); } catch {
    return json({ error: 'Corrupt email data' }, 500);
  }

  return json(email);
}

async function handleMarkRead(name, messageId, env) {
  // Update the email record
  const emailKey = `inbox:${name}:${messageId}`;
  const raw = await env.EMAIL_KV.get(emailKey);
  if (!raw) {
    return json({ error: 'Email not found' }, 404);
  }

  let email;
  try { email = JSON.parse(raw); } catch {
    return json({ error: 'Corrupt email data' }, 500);
  }

  email.read = true;
  await env.EMAIL_KV.put(emailKey, JSON.stringify(email), {
    expirationTtl: 60 * 60 * 24 * 90,
  });

  // Update the index entry
  const indexKey = `inbox:${name}:index`;
  const indexRaw = await env.EMAIL_KV.get(indexKey);
  if (indexRaw) {
    let index = [];
    try { index = JSON.parse(indexRaw); } catch {}
    const entry = index.find(e => e.messageId === messageId);
    if (entry) {
      entry.read = true;
      await env.EMAIL_KV.put(indexKey, JSON.stringify(index));
    }
  }

  return json({ success: true, messageId, read: true });
}

async function handleDeleteEmail(name, messageId, env) {
  // Delete the email record
  const emailKey = `inbox:${name}:${messageId}`;
  await env.EMAIL_KV.delete(emailKey);

  // Remove from index
  const indexKey = `inbox:${name}:index`;
  const indexRaw = await env.EMAIL_KV.get(indexKey);
  if (indexRaw) {
    let index = [];
    try { index = JSON.parse(indexRaw); } catch {}
    index = index.filter(e => e.messageId !== messageId);
    await env.EMAIL_KV.put(indexKey, JSON.stringify(index));
  }

  return json({ success: true, messageId, deleted: true });
}

// ─── Helpers ─────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

// ─── MIME Parsing (unchanged from original) ──────────────

/**
 * Extract plain text body from raw MIME email.
 * Handles multipart messages by finding text/plain parts.
 * Falls back to stripping HTML tags if only HTML is available.
 */
function extractTextBody(raw) {
  const contentTypeMatch = raw.match(/Content-Type:\s*([^\r\n;]+)/i);
  const contentType = contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : '';

  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = raw.split('--' + boundary);

    for (const part of parts) {
      if (/Content-Type:\s*text\/plain/i.test(part)) {
        return extractPartBody(part);
      }
    }

    for (const part of parts) {
      if (/Content-Type:\s*text\/html/i.test(part)) {
        const html = extractPartBody(part);
        return stripHtml(html);
      }
    }
  }

  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd !== -1) {
    const body = raw.slice(headerEnd + 4);
    if (contentType.includes('html')) {
      return stripHtml(body);
    }
    return body.trim();
  }

  return raw.trim();
}

function extractPartBody(part) {
  const headerEnd = part.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    const altEnd = part.indexOf('\n\n');
    if (altEnd === -1) return part.trim();
    return part.slice(altEnd + 2).trim();
  }
  let body = part.slice(headerEnd + 4).trim();

  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(part)) {
    body = decodeQuotedPrintable(body);
  }

  if (/Content-Transfer-Encoding:\s*base64/i.test(part)) {
    try {
      body = atob(body.replace(/\s/g, ''));
    } catch {
      // Leave as-is if decode fails
    }
  }

  return body;
}

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
