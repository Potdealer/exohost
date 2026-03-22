# ExoHost

Decentralized website hosting on Base. Squarespace but onchain.

Register a name, upload your site to Base blockchain via [Net Protocol](https://storedon.net), get a permanent URL at `yourname.mfer.one`. No servers, no monthly bills, no one can take it down.

**Contract**: [`0x71329A553e4134dE482725f98e10A4cBd90751f7`](https://basescan.org/address/0x71329A553e4134dE482725f98e10A4cBd90751f7) on Base mainnet

---

## Why

[Fleek](https://fleek.co) (the biggest decentralized hosting platform) shut down January 2026. Nobody filled the gap. Net Protocol has raw onchain storage but no human-readable names, no discoverability, no consumer product. ExoHost adds all three.

Your website lives entirely on Base. The name you register is an NFT you own forever. No domain renewals, no hosting invoices, no company that can pull the plug.

---

## How It Works

```
                           ┌──────────────────────────┐
 1. Register a name  ───>  │  ExoHostRegistry (Base)   │
                           │  name -> owner + wallet   │
                           │        + page keys        │
                           └──────────────────────────┘

                           ┌──────────────────────────┐
 2. Upload your site ───>  │  Net Protocol (Base)      │
                           │  HTML stored onchain      │
                           └──────────────────────────┘

                           ┌──────────────────────────┐
 3. Visitor hits URL ───>  │  Cloudflare Worker        │
                           │  name.mfer.one            │
                           │    -> read registry       │
                           │    -> fetch from Net      │
                           │    -> serve HTML          │
                           └──────────────────────────┘
```

A visitor goes to `ollie.mfer.one/about`. The Cloudflare Worker extracts the name (`ollie`) and route (`about`), calls the registry contract to find the storage wallet and key, fetches the HTML from Net Protocol, and serves it. The whole resolution happens in milliseconds.

---

## Pricing

One-time payment. Permanent ownership. No renewals ever.

| Name Length    | Fee       | Example         |
|----------------|-----------|-----------------|
| 3 characters   | 0.1 ETH   | `abc.mfer.one`  |
| 4 characters   | 0.01 ETH  | `cool.mfer.one` |
| 5+ characters  | 0.001 ETH | `mysite.mfer.one` |

---

## Quick Start

### Check if a name is available

```bash
npx exohost check mysite
```

### Register a name

```bash
npx exohost register mysite --key 0xYOUR_PRIVATE_KEY
```

This mints an ERC-721 NFT to your wallet. You now own `mysite.mfer.one`.

### Upload your site

```bash
npx exohost deploy mysite ./dist --key 0xYOUR_PRIVATE_KEY
```

The CLI uploads each HTML file to Net Protocol and registers the page routes onchain. Your site is live.

### Look up a name

```bash
npx exohost lookup ollie
```

### Preview a page

```bash
npx exohost preview ollie about
```

### Registry stats

```bash
npx exohost stats
```

---

## Name Rules

- Lowercase `a-z`, `0-9`, and hyphens only
- 3 to 32 characters
- No leading or trailing hyphens
- First-come-first-served (no auctions)
- Permanent ownership (no expiration)
- Transferable (standard ERC-721 — list on OpenSea, send to a friend, whatever)

---

## Gateway Architecture

The Cloudflare Worker at `mfer.one` handles all resolution. It is a single file (`cloudflare-worker.js`) with zero dependencies.

```
Request: ollie.mfer.one/about

1. Worker extracts subdomain "ollie" and route "about"
2. Calls resolvePage("ollie", "about") on the registry contract via eth_call
   -> returns (storageWallet, storageKey)
3. Fetches HTML from: storedon.net/net/8453/storage/load/{wallet}/{key}
4. Serves the HTML with caching headers
5. If no page key exists for that route, falls back to {homepageKey}-{route} convention
```

The gateway reads the contract directly via public RPC (`base-rpc.publicnode.com`). No backend, no database, no API keys.

### Error Pages

- **Unregistered name**: 404 with a prompt to register it
- **Page not uploaded**: 404 with the exact Net Protocol CLI command to upload the missing page
- **RPC error**: 502 with error details

---

## Contract

**ExoHostRegistry** is an ERC-721 that maps human-readable names to Net Protocol storage locations.

### Key Functions

| Function | Description |
|----------|-------------|
| `register(name)` | Register a name, mint NFT. Uses sender's wallet and name as defaults. |
| `register(name, wallet, key)` | Register with explicit storage wallet and homepage key. |
| `resolve(name)` | Returns `(owner, storageWallet, homepageKey)`. Used by the gateway. |
| `resolvePage(name, route)` | Returns `(storageWallet, key)` for a specific page route. |
| `setStorageWallet(tokenId, wallet)` | Point your name at a different wallet's Net storage. |
| `setHomepageKey(tokenId, key)` | Change the index page storage key. |
| `setPageKey(tokenId, route, key)` | Map a URL path to a storage key (e.g., `about` -> `mysite-about`). |
| `removePageKey(tokenId, route)` | Remove a page route. |
| `isAvailable(name)` | Check if a name is available. |
| `getPrice(name)` | Get the registration fee for a name. |

### Data Model

```solidity
struct Site {
    address storageWallet;   // Wallet whose Net storage holds the files
    string homepageKey;      // Storage key for the index page
    uint256 pageCount;       // Number of configured page routes
}
```

Each name maps to a `Site`, and each site can have multiple page routes that map URL paths to Net Protocol storage keys.

---

## Cost Reality

Based on real data from [exoagent.xyz](https://exoagent.xyz) (13 pages, running onchain since February 2026):

| Operation | Cost |
|-----------|------|
| Contract deployment | ~$0.02 |
| Name registration (gas) | ~$0.001 |
| Full 13-page site upload | ~$23 total (440 transactions) |
| Biggest single page (44KB) | $0.24 |
| Average page upload | ~$0.05 |

Your total cost for a basic site: the name fee + a few bucks in upload gas. That's it. Forever.

---

## Development

ExoHost uses [Foundry](https://book.getfoundry.sh/).

### Build

```bash
forge build
```

### Test

```bash
forge test
```

44 tests covering registration, pricing, name validation, site configuration, resolution, transfers, and admin functions.

### Deploy

```bash
forge create src/ExoHostRegistry.sol:ExoHostRegistry \
  --rpc-url https://base-rpc.publicnode.com \
  --private-key $PRIVATE_KEY
```

### Project Structure

```
src/
  ExoHostRegistry.sol    # The registry contract (ERC-721)
test/
  ExoHostRegistry.t.sol  # 44 Foundry tests
cli/
  bin/exohost.js         # CLI entrypoint
  src/registry.js        # Contract interaction helpers
  src/deploy.js          # Site upload + route configuration
  src/constants.js       # Addresses and ABIs
cloudflare-worker.js     # Gateway worker (single file, zero deps)
wrangler.toml            # Cloudflare Worker config
```

---

## Links

- **Gateway**: [mfer.one](https://mfer.one)
- **Contract**: [Basescan](https://basescan.org/address/0x71329A553e4134dE482725f98e10A4cBd90751f7)
- **Net Protocol**: [storedon.net](https://storedon.net)
- **Exoskeletons**: [exoagent.xyz](https://exoagent.xyz)
- **GitHub**: [Potdealer/exohost](https://github.com/Potdealer/exohost)
- **Twitter**: [@ollie_exo](https://twitter.com/ollie_exo)

---

Part of the [Exoskeletons](https://exoagent.xyz) ecosystem. Built by [potdealer](https://github.com/Potdealer) and [Ollie](https://twitter.com/ollie_exo).
