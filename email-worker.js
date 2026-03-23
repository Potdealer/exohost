/**
 * mfer.one Email Worker — handles incoming email for all @mfer.one addresses.
 *
 * Flow:
 *   1. Someone sends email to agent@mfer.one
 *   2. Cloudflare Email Routing triggers this worker
 *   3. Worker parses the email, extracts headers/body
 *   4. POSTs JSON payload to the agent's webhook endpoint
 *   5. Forwards a copy to FALLBACK_EMAIL as backup
 *
 * Deploy: npx wrangler deploy -c wrangler-email.toml
 */

// Max email body size to process (256KB)
const MAX_BODY_SIZE = 256 * 1024;

// Max number of lines to keep from body (prevent huge emails)
const MAX_BODY_LINES = 500;

export default {
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

    console.log(`[email-worker] Incoming: ${from} -> ${to} (${localPart}) Subject: "${subject}"`);

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
      console.log(`[email-worker] Error reading body: ${err.message}`);
      rawBody = '(error reading email body)';
    }

    // Parse the email body — extract text content from the raw MIME
    const body = extractTextBody(rawBody);

    // Truncate body lines
    const lines = body.split('\n');
    const truncatedBody = lines.length > MAX_BODY_LINES
      ? lines.slice(0, MAX_BODY_LINES).join('\n') + '\n\n[... truncated]'
      : body;

    // Build the JSON payload
    const payload = {
      from,
      to,
      localPart,
      subject,
      body: truncatedBody,
      timestamp: new Date().toISOString(),
      messageId,
      inReplyTo,
      references,
      date,
    };

    // POST to the agent's webhook endpoint
    const webhookBaseUrl = env.WEBHOOK_BASE_URL || 'http://localhost:8430';
    const webhookUrl = `${webhookBaseUrl}/email`;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log(`[email-worker] Webhook delivered to ${webhookUrl}`);
      } else {
        console.log(`[email-worker] Webhook failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.log(`[email-worker] Webhook error: ${err.message}`);
    }

    // Forward to fallback email as backup
    const fallbackEmail = env.FALLBACK_EMAIL;
    if (fallbackEmail) {
      try {
        await message.forward(fallbackEmail);
        console.log(`[email-worker] Forwarded to fallback: ${fallbackEmail}`);
      } catch (err) {
        console.log(`[email-worker] Forward failed: ${err.message}`);
      }
    }
  },
};

/**
 * Extract plain text body from raw MIME email.
 * Handles multipart messages by finding text/plain parts.
 * Falls back to stripping HTML tags if only HTML is available.
 */
function extractTextBody(raw) {
  // Check if this is a multipart message
  const contentTypeMatch = raw.match(/Content-Type:\s*([^\r\n;]+)/i);
  const contentType = contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : '';

  // Try to find boundary for multipart
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = raw.split('--' + boundary);

    // Look for text/plain part first
    for (const part of parts) {
      if (/Content-Type:\s*text\/plain/i.test(part)) {
        return extractPartBody(part);
      }
    }

    // Fall back to text/html, strip tags
    for (const part of parts) {
      if (/Content-Type:\s*text\/html/i.test(part)) {
        const html = extractPartBody(part);
        return stripHtml(html);
      }
    }
  }

  // Not multipart — extract body after headers
  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd !== -1) {
    const body = raw.slice(headerEnd + 4);
    if (contentType.includes('html')) {
      return stripHtml(body);
    }
    return body.trim();
  }

  // Last resort
  return raw.trim();
}

/**
 * Extract the body portion of a MIME part (after the part's headers).
 */
function extractPartBody(part) {
  const headerEnd = part.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    const altEnd = part.indexOf('\n\n');
    if (altEnd === -1) return part.trim();
    return part.slice(altEnd + 2).trim();
  }
  let body = part.slice(headerEnd + 4).trim();

  // Handle quoted-printable encoding
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(part)) {
    body = decodeQuotedPrintable(body);
  }

  // Handle base64 encoding
  if (/Content-Transfer-Encoding:\s*base64/i.test(part)) {
    try {
      body = atob(body.replace(/\s/g, ''));
    } catch {
      // Leave as-is if decode fails
    }
  }

  return body;
}

/**
 * Decode quoted-printable encoding.
 */
function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '') // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Strip HTML tags and decode common entities.
 */
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
