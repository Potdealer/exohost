#!/usr/bin/env node

import { ethers } from 'ethers';
import { checkAvailability, resolveName, getStats, registerName, fetchPage } from '../src/registry.js';
import { deploySite } from '../src/deploy.js';

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`
  exohost — Decentralized website hosting on Base

  Usage:
    exohost register <name> [--key <private-key>] [--wallet <storage-wallet>] [--homepage <key>]
    exohost deploy <name> <path> [--key <private-key>]
    exohost lookup <name>
    exohost check <name>
    exohost preview <name> [route]
    exohost stats

  Commands:
    register   Register a name on ExoHost (mints an NFT)
    deploy     Upload a site directory to Net storage and configure routes
    lookup     Look up a registered name (owner, wallet, pages)
    check      Check if a name is available and its price
    preview    Fetch and display a page from Net storage
    stats      Show registry statistics

  Options:
    --key      Private key for write operations (or set PRIVATE_KEY env var)
    --wallet   Storage wallet address (defaults to sender)
    --homepage Homepage storage key (defaults to name)

  Pricing:
    3 characters   0.1 ETH
    4 characters   0.01 ETH
    5+ characters  0.001 ETH

  Examples:
    exohost check mysite
    exohost register mysite --key 0x...
    exohost deploy mysite ./dist --key 0x...
    exohost lookup ollie
`);
}

function getPrivateKey() {
  const idx = args.indexOf('--key');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY;
  console.error('Error: Private key required. Use --key or set PRIVATE_KEY env var.');
  process.exit(1);
}

function getFlag(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return null;
}

async function main() {
  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  switch (command) {
    case 'check': {
      const name = args[1];
      if (!name) { console.error('Usage: exohost check <name>'); process.exit(1); }

      const { available, price } = await checkAvailability(name);
      console.log(`\n  Name:      ${name}`);
      console.log(`  Available: ${available ? 'Yes' : 'No (taken)'}`);
      console.log(`  Price:     ${ethers.formatEther(price)} ETH`);
      console.log(`  URL:       ${name}.exohost.xyz\n`);
      break;
    }

    case 'lookup': {
      const name = args[1];
      if (!name) { console.error('Usage: exohost lookup <name>'); process.exit(1); }

      const info = await resolveName(name);
      if (!info) {
        console.log(`\n  "${name}" is not registered.\n`);
        break;
      }

      console.log(`\n  Name:           ${name}`);
      console.log(`  Token ID:       #${info.tokenId}`);
      console.log(`  Owner:          ${info.owner}`);
      console.log(`  Storage Wallet: ${info.storageWallet}`);
      console.log(`  Homepage Key:   ${info.homepageKey}`);
      console.log(`  URL:            ${name}.exohost.xyz`);

      if (Object.keys(info.pages).length > 0) {
        console.log(`  Pages:`);
        for (const [route, key] of Object.entries(info.pages)) {
          console.log(`    /${route} → ${key}`);
        }
      }
      console.log();
      break;
    }

    case 'register': {
      const name = args[1];
      if (!name) { console.error('Usage: exohost register <name> --key <key>'); process.exit(1); }

      const pk = getPrivateKey();
      const wallet = getFlag('--wallet');
      const homepage = getFlag('--homepage');

      // Pre-check
      const { available, price } = await checkAvailability(name);
      if (!available) {
        console.error(`\n  Error: "${name}" is already taken.\n`);
        process.exit(1);
      }

      console.log(`\n  Registering "${name}" for ${ethers.formatEther(price)} ETH...`);

      const result = await registerName(name, pk, wallet, homepage);
      console.log(`  Success!`);
      console.log(`  Token ID: #${result.tokenId}`);
      console.log(`  TX:       ${result.tx}`);
      console.log(`  URL:      ${name}.exohost.xyz\n`);
      break;
    }

    case 'deploy': {
      const name = args[1];
      const sitePath = args[2];
      if (!name || !sitePath) {
        console.error('Usage: exohost deploy <name> <path> --key <key>');
        process.exit(1);
      }

      const pk = getPrivateKey();

      // Look up the name to get tokenId
      const info = await resolveName(name);
      if (!info) {
        console.error(`\n  Error: "${name}" is not registered. Register it first with: exohost register ${name}\n`);
        process.exit(1);
      }

      // Verify caller owns the name
      const signer = new ethers.Wallet(pk);
      if (info.owner.toLowerCase() !== signer.address.toLowerCase()) {
        console.error(`\n  Error: Your wallet (${signer.address}) does not own "${name}" (owned by ${info.owner})\n`);
        process.exit(1);
      }

      await deploySite(sitePath, name, info.tokenId, pk, {
        keyPrefix: getFlag('--prefix') || name
      });
      break;
    }

    case 'preview': {
      const name = args[1];
      const route = args[2] || null;
      if (!name) { console.error('Usage: exohost preview <name> [route]'); process.exit(1); }

      const content = await fetchPage(name, route);
      if (!content) {
        console.log(`\n  No content found for "${name}"${route ? `/${route}` : ''}.\n`);
        break;
      }

      // Show first 2000 chars
      const preview = content.length > 2000 ? content.slice(0, 2000) + '\n... (truncated)' : content;
      console.log(preview);
      break;
    }

    case 'stats': {
      const { totalRegistered } = await getStats();
      console.log(`\n  ExoHost Registry Stats`);
      console.log(`  ─────────────────────`);
      console.log(`  Total Names: ${totalRegistered}`);
      console.log(`  Contract:    0x71329A553e4134dE482725f98e10A4cBd90751f7`);
      console.log(`  Chain:       Base (8453)\n`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
