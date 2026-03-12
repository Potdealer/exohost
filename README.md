# ExoHost

**Decentralized website hosting on Base. Squarespace but onchain.**

Register a name, upload your site to Base blockchain via Net Protocol, get a permanent URL at `yourname.mfer.one`. No servers, no monthly bills, no one can take it down.

**Contract**: [`0x71329A553e4134dE482725f98e10A4cBd90751f7`](https://basescan.org/address/0x71329A553e4134dE482725f98e10A4cBd90751f7) | **Chain**: Base (8453) | **44 tests passing**

---

## How It Works

1. Register a name (e.g., "ollie") — mints an ERC-721 NFT
2. Upload your website to Base via Net Protocol
3. Your site is live at `ollie.mfer.one`

That's it. Your website is permanent, censorship-resistant, and costs a couple bucks total — not per month, total.

## What's Deployed

- ExoHostRegistry contract live on Base mainnet
- Names are transferable ERC-721 NFTs with permanent ownership (no expiration)
- 2 names registered: `ollie` (#1), `exoskeletons` (#2)
- Resolution verified working onchain
- Gateway domain: `mfer.one`
- 44 tests passing

## Pricing

| Name Length | Fee |
|-------------|-----|
| 3 characters | 0.1 ETH |
| 4 characters | 0.01 ETH |
| 5+ characters | 0.001 ETH |

One-time payment. Permanent ownership. No renewals.

## Name Rules

- Lowercase a-z, 0-9, hyphens
- 3-32 characters
- No leading or trailing hyphens
- First-come-first-served (no auctions)
- Permanent ownership, no expiration
- Transferable (standard ERC-721)

## Architecture

```
User registers name  ──→  ExoHostRegistry (Base)
                           maps name → owner + storage wallet + page keys

User uploads site    ──→  Net Protocol storage (Base)
                           same storedon.net pattern

Visitor hits URL     ──→  Cloudflare Worker (mfer.one)
                           extracts name from subdomain
                           reads registry for wallet + keys
                           fetches from Net storage
                           serves HTML
```

## Contract Functions

| Function | Description |
|----------|-------------|
| `register(name)` | Register name, mint NFT |
| `register(name, wallet, key)` | Register with explicit storage wallet and homepage key |
| `setStorageWallet(tokenId, wallet)` | Point name at different wallet's Net storage |
| `setHomepageKey(tokenId, key)` | Change the index page storage key |
| `setPageKey(tokenId, route, key)` | Map URL path to storage key (e.g., "/about" -> "mysite-about") |
| `removePageKey(tokenId, route)` | Remove a page route |
| `resolve(name)` | Returns (owner, storageWallet, homepageKey) |
| `resolvePage(name, route)` | Returns (storageWallet, key) for a specific page |
| `isAvailable(name)` | Check if name is taken |
| `getPrice(name)` | Get registration fee |

## Gateway Resolution

```
Request: ollie.mfer.one/about

1. Worker extracts: name="ollie", route="about"
2. Worker calls: resolvePage("ollie", "about")
   → returns (0x2460..., "ollie-about")
3. Worker fetches: storedon.net/net/8453/storage/load/0x2460.../ollie-about
4. Worker serves HTML with proper headers
5. If no page key for route, falls back to homepage
```

## Cost Reality

Based on real data from exoagent.xyz (13 pages, running since February 2026):

| Operation | Cost |
|-----------|------|
| Contract deployment | ~$0.02 |
| Name registration (gas) | ~$0.001 |
| Full 13-page site upload | ~$23 total (440 transactions) |
| Biggest single page (44KB) | $0.24 |
| Average page upload | ~$0.05 |

## Why This Matters

Fleek (the biggest decentralized hosting platform) shut down Jan 31, 2026. Nobody's filled the gap. Net Protocol has raw storage but no human-readable names, no discoverability, no consumer product layer. ExoHost adds all three.

Every ExoHost user becomes a Net Protocol user. Names are NFTs that can be traded. And every Exoskeleton could eventually get its own auto-generated website — identity extends to presence.

## Tech Stack

- Solidity 0.8.24 / Foundry
- ERC-721 (names as transferable NFTs)
- Net Protocol for onchain storage
- Cloudflare Worker for gateway resolution
- Domain: mfer.one (Porkbun)

---

Built by [potdealer](https://github.com/Potdealer) and [Ollie](https://twitter.com/ollie_exo).
