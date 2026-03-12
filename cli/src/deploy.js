import { ethers } from 'ethers';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, relative, extname } from 'path';
import { NET_STORAGE_CONTRACT, NET_STORAGE_ABI, BASE_RPC } from './constants.js';
import { getSignerFromKey, setPageKey, setHomepageKey } from './registry.js';

const MAX_CHUNK_SIZE = 24_000; // ~24KB per tx (safe limit for Net storage)

function leftPadKey(key) {
  const encoded = new TextEncoder().encode(key);
  if (encoded.length > 32) {
    throw new Error(`Storage key "${key}" exceeds 32 bytes`);
  }
  const padded = new Uint8Array(32);
  padded.set(encoded, 32 - encoded.length);
  return ethers.hexlify(padded);
}

function collectFiles(dir, base) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, base));
    } else {
      const rel = relative(base, fullPath);
      files.push({ path: fullPath, route: rel });
    }
  }
  return files;
}

export async function deploySite(siteDir, name, tokenId, privateKey, opts = {}) {
  const signer = getSignerFromKey(privateKey);
  const net = new ethers.Contract(NET_STORAGE_CONTRACT, NET_STORAGE_ABI, signer);
  const prefix = opts.keyPrefix || name;
  const results = [];

  // Collect files
  let files;
  if (statSync(siteDir).isDirectory()) {
    files = collectFiles(siteDir, siteDir);
  } else {
    // Single file
    files = [{ path: siteDir, route: 'index.html' }];
  }

  console.log(`\nDeploying ${files.length} file(s) for "${name}"...\n`);

  for (const file of files) {
    const content = readFileSync(file.path);
    const route = file.route.replace(/\\/g, '/'); // normalize Windows paths
    const isIndex = route === 'index.html';
    const storageKey = isIndex ? prefix : `${prefix}-${route.replace(/\//g, '-').replace(/\.html$/, '')}`;
    const pageRoute = isIndex ? null : route.replace(/\.html$/, '').replace(/^\//, '');

    console.log(`  ${route} → key "${storageKey}" (${content.length} bytes)`);

    // Upload to Net storage (chunked if needed)
    if (content.length <= MAX_CHUNK_SIZE) {
      const key32 = leftPadKey(storageKey);
      const tx = await net.store(key32, content);
      await tx.wait();
      console.log(`    uploaded: ${tx.hash}`);
    } else {
      // Chunk it
      const chunks = Math.ceil(content.length / MAX_CHUNK_SIZE);
      console.log(`    chunked: ${chunks} parts`);
      for (let i = 0; i < chunks; i++) {
        const chunkKey = `${storageKey}-${i}`;
        const chunk = content.subarray(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE);
        const key32 = leftPadKey(chunkKey);
        const tx = await net.store(key32, chunk);
        await tx.wait();
        console.log(`    part ${i + 1}/${chunks}: ${tx.hash}`);
      }
    }

    // Update registry mapping
    if (isIndex) {
      if (tokenId) {
        const r = await setHomepageKey(tokenId, storageKey, privateKey);
        console.log(`    homepage key set: ${r.tx}`);
      }
    } else if (pageRoute && tokenId) {
      const r = await setPageKey(tokenId, pageRoute, storageKey, privateKey);
      console.log(`    page route "${pageRoute}" set: ${r.tx}`);
    }

    results.push({ route, storageKey, size: content.length });
  }

  console.log(`\nDone! ${results.length} file(s) deployed.`);
  if (tokenId) {
    console.log(`Site will be live at: ${name}.exohost.xyz`);
  }

  return results;
}
