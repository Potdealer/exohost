/**
 * mfer.one — Decentralized Hosting Gateway
 * Resolves {name}.mfer.one subdomains to onchain content via ExoHost Registry on Base.
 *
 * Flow: subdomain → ExoHostRegistry.resolve/resolvePage → Net Protocol storage → HTML
 * No dependencies. Single file worker.
 */

// ─── Configuration ─────────────────────────────────────────
const EXOHOST_REGISTRY = '0x71329A553e4134dE482725f98e10A4cBd90751f7';    // V1
const EXOHOST_REGISTRY_V2 = '0x0000000000000000000000000000000000000000';  // V2 — UPDATE after deployment
const BASE_RPC = 'https://base-rpc.publicnode.com';
const STOREDON_BASE = 'https://storedon.net/net/8453/storage/load';
const GATEWAY_DOMAIN = 'mfer.one';

// Function selectors (keccak256 first 4 bytes)
const RESOLVE_SELECTOR = '0x461a4478';      // resolve(string)
const RESOLVE_PAGE_SELECTOR = '0xad67af91'; // resolvePage(string,string)
const NAME_TO_TOKEN_ID_SELECTOR = '0xdd001254'; // nameToTokenId(string)
const GET_PAGE_SELECTOR = '0x137a3c96';          // getPage(uint256)

// ─── ABI Encoding Helpers ──────────────────────────────────

/**
 * Encode a string for Solidity ABI: length (32 bytes) + utf8 data (padded to 32-byte boundary)
 */
function abiEncodeString(str) {
  const hex = Array.from(new TextEncoder().encode(str))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const len = str.length.toString(16).padStart(64, '0');
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
  return len + padded;
}

/**
 * Encode resolve(string name) calldata
 */
function encodeResolve(name) {
  const offset = '0000000000000000000000000000000000000000000000000000000000000020';
  return RESOLVE_SELECTOR + offset + abiEncodeString(name);
}

/**
 * Encode resolvePage(string name, string route) calldata
 */
function encodeResolvePage(name, route) {
  const nameHex = abiEncodeString(name);
  const nameSlots = nameHex.length / 2; // bytes
  const offset1 = '0000000000000000000000000000000000000000000000000000000000000040';
  const offset2Num = 64 + nameSlots;
  const offset2 = offset2Num.toString(16).padStart(64, '0');
  return RESOLVE_PAGE_SELECTOR + offset1 + offset2 + nameHex + abiEncodeString(route);
}

// ─── Contract Interaction ──────────────────────────────────

/**
 * Call a contract view function via eth_call
 */
async function ethCall(to, data) {
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to, data }, 'latest']
    })
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}

/**
 * Decode resolve() response: (address owner, address storageWallet, string homepageKey)
 * Returns null if name not registered (owner = zero address)
 */
function decodeResolve(result) {
  if (!result || result === '0x' || result.length < 130) return null;
  const data = result.slice(2);
  const owner = '0x' + data.slice(24, 64);
  const wallet = '0x' + data.slice(88, 128);
  const strOffset = parseInt(data.slice(128, 192), 16) * 2;
  const strLen = parseInt(data.slice(strOffset, strOffset + 64), 16);
  const strHex = data.slice(strOffset + 64, strOffset + 64 + strLen * 2);
  const key = strLen > 0
    ? new TextDecoder().decode(new Uint8Array(strHex.match(/.{2}/g).map(b => parseInt(b, 16))))
    : '';
  if (owner === '0x0000000000000000000000000000000000000000') return null;
  return { owner, wallet, key };
}

/**
 * Decode resolvePage() response: (address storageWallet, string key)
 * Returns null if name not registered (wallet = zero address)
 */
function decodeResolvePage(result) {
  if (!result || result === '0x' || result.length < 130) return null;
  const data = result.slice(2);
  const wallet = '0x' + data.slice(24, 64);
  const strOffset = parseInt(data.slice(64, 128), 16) * 2;
  const strLen = parseInt(data.slice(strOffset, strOffset + 64), 16);
  if (strLen === 0) return { wallet, key: '' };
  const strHex = data.slice(strOffset + 64, strOffset + 64 + strLen * 2);
  const key = new TextDecoder().decode(new Uint8Array(
    strHex.match(/.{2}/g).map(b => parseInt(b, 16))
  ));
  if (wallet === '0x0000000000000000000000000000000000000000') return null;
  return { wallet, key };
}

/**
 * Encode nameToTokenId(string name) calldata
 */
function encodeNameToTokenId(name) {
  const offset = '0000000000000000000000000000000000000000000000000000000000000020';
  return NAME_TO_TOKEN_ID_SELECTOR + offset + abiEncodeString(name);
}

/**
 * Encode getPage(uint256 tokenId) calldata
 */
function encodeGetPage(tokenId) {
  const id = tokenId.toString(16).padStart(64, '0');
  return GET_PAGE_SELECTOR + id;
}

/**
 * Decode a uint256 return value
 */
function decodeUint256(result) {
  if (!result || result === '0x' || result.length < 66) return 0;
  return parseInt(result.slice(2, 66), 16);
}

/**
 * Decode a string return value (single dynamic string)
 */
function decodeString(result) {
  if (!result || result === '0x' || result.length < 130) return '';
  const data = result.slice(2);
  const strOffset = parseInt(data.slice(0, 64), 16) * 2;
  const strLen = parseInt(data.slice(strOffset, strOffset + 64), 16);
  if (strLen === 0) return '';
  const strHex = data.slice(strOffset + 64, strOffset + 64 + strLen * 2);
  return new TextDecoder().decode(new Uint8Array(
    strHex.match(/.{2}/g).map(b => parseInt(b, 16))
  ));
}

/**
 * Check V2 contract for onchain page content.
 * Returns the HTML string if found, or null if no page stored.
 */
async function getV2OnchainPage(name) {
  // Skip if V2 not deployed yet
  if (EXOHOST_REGISTRY_V2 === '0x0000000000000000000000000000000000000000') return null;

  try {
    // Get tokenId for name
    const tokenIdResult = await ethCall(EXOHOST_REGISTRY_V2, encodeNameToTokenId(name));
    const tokenId = decodeUint256(tokenIdResult);
    if (tokenId === 0) return null; // Not registered on V2

    // Get page content
    const pageResult = await ethCall(EXOHOST_REGISTRY_V2, encodeGetPage(tokenId));
    const content = decodeString(pageResult);
    return content.length > 0 ? content : null;
  } catch {
    return null; // V2 call failed, fall back to V1/Net Protocol
  }
}

// ─── CORS Headers ──────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Request Handler ───────────────────────────────────────

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);
      const host = url.hostname;

      // Extract subdomain
      const parts = host.split('.');
      const isSubdomain = parts.length > 2 ||
        (parts.length === 2 && parts[0] !== 'mfer');

      // Skip www
      if (parts[0] === 'www') {
        parts.shift();
      }

      // Root domain: mfer.one → landing page
      if (!isSubdomain || parts[0] === 'www') {
        return landingPage();
      }

      // Subdomain: {name}.mfer.one
      const name = parts.slice(0, parts.length - 2).join('.');
      if (!name) return landingPage();

      // Extract route from path
      let route = url.pathname.replace(/\/+$/, '').replace(/^\//, '') || '';
      route = route.replace(/\.html$/, '');

      const htmlHeaders = {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Powered-By': 'mfer.one — onchain hosting on Base',
        ...CORS_HEADERS,
      };

      // ── Priority 1: Check V2 onchain page (homepage only) ──
      if (!route || route === 'index') {
        const onchainPage = await getV2OnchainPage(name);
        if (onchainPage) {
          return new Response(onchainPage, { headers: htmlHeaders });
        }
      }

      // ── Priority 2: Fall back to V1 + Net Protocol storage ──
      let wallet, storageKey;

      if (route && route !== 'index') {
        // Try resolvePage for specific route
        const pageResult = await ethCall(EXOHOST_REGISTRY, encodeResolvePage(name, route));
        const page = decodeResolvePage(pageResult);

        if (page && page.key) {
          wallet = page.wallet;
          storageKey = page.key;
        } else {
          // No specific page key — fall back to homepage-key + "-" + route convention
          const resolveResult = await ethCall(EXOHOST_REGISTRY, encodeResolve(name));
          const site = decodeResolve(resolveResult);
          if (!site) return notFoundPage(name);
          wallet = site.wallet;
          storageKey = `${site.key}-${route}`;
        }
      } else {
        // Homepage — V2 didn't have it, check V1
        const resolveResult = await ethCall(EXOHOST_REGISTRY, encodeResolve(name));
        const site = decodeResolve(resolveResult);
        if (!site) return notFoundPage(name);
        wallet = site.wallet;
        storageKey = site.key;
      }

      // Fetch content from Net Protocol (bust cache with timestamp)
      const storeUrl = `${STOREDON_BASE}/${wallet}/${storageKey}?_t=${Date.now()}`;
      const response = await fetch(storeUrl, { cf: { cacheTtl: 0, cacheEverything: false } });

      if (!response.ok) {
        return pageNotUploaded(name, route, storageKey);
      }

      const html = await response.text();
      return new Response(html, { headers: htmlHeaders });

    } catch (err) {
      return errorPage(err.message);
    }
  },
};

// ─── HTML Pages ────────────────────────────────────────────

function landingPage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mfer.one — onchain hosting</title>
  <meta name="description" content="Decentralized website hosting on Base. Register a name, deploy your site onchain, own it forever.">
  <meta property="og:title" content="mfer.one — onchain hosting">
  <meta property="og:description" content="Register a name. Deploy your site onchain. Own it forever.">
  <meta property="og:url" content="https://mfer.one">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: 'Courier New', Courier, monospace;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2em;
    }
    .container { max-width: 640px; width: 100%; text-align: center; }
    h1 {
      font-size: 3em;
      color: #00ff88;
      margin-bottom: 0.2em;
      letter-spacing: 0.05em;
    }
    .tagline {
      font-size: 1.1em;
      color: #888;
      margin-bottom: 2em;
    }
    .how {
      text-align: left;
      background: #111;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 1.5em;
      margin-bottom: 2em;
    }
    .how h2 {
      color: #00ff88;
      font-size: 1.2em;
      margin-bottom: 1em;
    }
    .step {
      margin-bottom: 1em;
      line-height: 1.6;
    }
    .step .num {
      color: #00ff88;
      font-weight: bold;
    }
    code {
      background: #1a1a1a;
      color: #ffaa00;
      padding: 0.15em 0.4em;
      border-radius: 3px;
      font-size: 0.9em;
    }
    .pricing {
      text-align: left;
      background: #111;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 1.5em;
      margin-bottom: 2em;
    }
    .pricing h2 {
      color: #00ff88;
      font-size: 1.2em;
      margin-bottom: 1em;
    }
    .pricing table { width: 100%; border-collapse: collapse; }
    .pricing td, .pricing th {
      padding: 0.4em 0.6em;
      text-align: left;
      border-bottom: 1px solid #222;
    }
    .pricing th { color: #888; font-size: 0.85em; }
    .pricing td:last-child { text-align: right; color: #ffaa00; }
    .info {
      color: #666;
      font-size: 0.85em;
      line-height: 1.6;
      margin-bottom: 2em;
    }
    .info a { color: #00ff88; text-decoration: none; }
    .info a:hover { text-decoration: underline; }
    .contract {
      font-size: 0.75em;
      color: #444;
      word-break: break-all;
    }
    .contract a { color: #555; text-decoration: none; }
    .contract a:hover { color: #00ff88; }
  </style>
</head>
<body>
  <div class="container">
    <h1>mfer.one</h1>
    <p class="tagline">onchain hosting on Base</p>

    <div class="how">
      <h2>how it works</h2>
      <div class="step">
        <span class="num">1.</span> Register a name onchain (it's an NFT you own forever)
      </div>
      <div class="step">
        <span class="num">2.</span> Upload your site to Base via Net Protocol
      </div>
      <div class="step">
        <span class="num">3.</span> Your site is live at <code>yourname.mfer.one</code>
      </div>
      <div class="step" style="color:#888; font-size:0.9em; margin-top:1em;">
        No servers. No monthly bills. No one can take it down.
      </div>
    </div>

    <div class="pricing">
      <h2>pricing (one-time, forever)</h2>
      <table>
        <tr><th>Name Length</th><th>Fee</th></tr>
        <tr><td>3 characters</td><td>0.01 ETH</td></tr>
        <tr><td>4 characters</td><td>0.001 ETH</td></tr>
        <tr><td>5+ characters</td><td>FREE</td></tr>
      </table>
    </div>

    <p class="info">
      Names are lowercase a-z, 0-9, and hyphens. 3-32 characters. Permanent ownership.<br>
      Built on <a href="https://storedon.net" target="_blank">Net Protocol</a> and
      <a href="https://base.org" target="_blank">Base</a>.<br>
      Part of the <a href="https://exoagent.xyz" target="_blank">Exoskeletons</a> ecosystem.
    </p>

    <p class="contract">
      Registry: <a href="https://basescan.org/address/${EXOHOST_REGISTRY}" target="_blank">${EXOHOST_REGISTRY}</a>
    </p>
  </div>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      ...CORS_HEADERS,
    },
  });
}

function notFoundPage(name) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}.mfer.one — not registered</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: 'Courier New', Courier, monospace;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2em;
    }
    .box {
      max-width: 480px;
      text-align: center;
    }
    h1 { color: #ff4444; font-size: 2em; margin-bottom: 0.5em; }
    p { color: #888; line-height: 1.6; margin-bottom: 1em; }
    code {
      background: #1a1a1a;
      color: #ffaa00;
      padding: 0.15em 0.4em;
      border-radius: 3px;
      font-size: 0.9em;
    }
    a { color: #00ff88; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="box">
    <h1>404</h1>
    <p><code>${name}.mfer.one</code> is not registered.</p>
    <p>This name could be yours.</p>
    <p style="font-size:0.85em;">
      Register it on the <a href="https://basescan.org/address/${EXOHOST_REGISTRY}#writeContract" target="_blank">ExoHost Registry</a>
    </p>
    <p style="font-size:0.75em; color:#444;">
      <a href="https://mfer.one">mfer.one</a> — onchain hosting on Base
    </p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

function pageNotUploaded(name, route, storageKey) {
  const display = route ? `${name}.mfer.one/${route}` : `${name}.mfer.one`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${display} — page not found</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: 'Courier New', Courier, monospace;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2em;
    }
    .box { max-width: 520px; text-align: center; }
    h1 { color: #ffaa00; font-size: 2em; margin-bottom: 0.5em; }
    p { color: #888; line-height: 1.6; margin-bottom: 1em; }
    code {
      background: #1a1a1a;
      color: #ffaa00;
      padding: 0.15em 0.4em;
      border-radius: 3px;
      font-size: 0.85em;
      display: inline-block;
      margin-top: 0.3em;
    }
    a { color: #00ff88; text-decoration: none; }
  </style>
</head>
<body>
  <div class="box">
    <h1>page not uploaded</h1>
    <p><code>${display}</code> is registered but this page hasn't been uploaded yet.</p>
    <p style="font-size:0.85em;">Upload it with:</p>
    <p><code>npx @net-protocol/cli storage store --key "${storageKey}" --file index.html --chain-id 8453</code></p>
    <p style="font-size:0.75em; color:#444;">
      <a href="https://mfer.one">mfer.one</a> — onchain hosting on Base
    </p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

function errorPage(message) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mfer.one — error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: 'Courier New', Courier, monospace;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2em;
    }
    .box { max-width: 480px; text-align: center; }
    h1 { color: #ff4444; font-size: 2em; margin-bottom: 0.5em; }
    p { color: #888; line-height: 1.6; margin-bottom: 1em; }
    code { background: #1a1a1a; color: #ff6666; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.85em; }
    a { color: #00ff88; text-decoration: none; }
  </style>
</head>
<body>
  <div class="box">
    <h1>502</h1>
    <p>Something went wrong resolving this site.</p>
    <p style="font-size:0.85em;"><code>${message}</code></p>
    <p style="font-size:0.75em; color:#444;">
      <a href="https://mfer.one">mfer.one</a> — onchain hosting on Base
    </p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 502,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}
