# ExoHost — Decentralized Website Hosting on Base

## The Simple Version

**What is it?**
ExoHost lets anyone register a name and deploy a website that's stored entirely onchain on Base blockchain. No servers, no monthly hosting bills, no one can take it down.

**How does it work?**
1. You register a name (like "ollie" or "myproject")
2. You upload your website files to Base blockchain via Net Protocol
3. Your site is live at `yourname.mfer.one`

That's it. Your website is permanent, censorship-resistant, and costs a couple bucks total — not per month, total.

**What does it do for us?**
- Revenue from name registration fees (0.001-0.1 ETH per name depending on length)
- Every ExoHost user becomes a Net Protocol user (drives ecosystem growth)
- Names are NFTs — they can be traded, transferred, sold
- Foundation for agent auto-sites: every Exoskeleton could get its own website
- Extends the Exoskeleton identity platform (identity → website → presence)

**What does it do for Net Protocol?**
- **Naming layer** — Net has raw storage but no human-readable names. ExoHost adds that.
- **Discoverability** — No way to browse what's on Net today. ExoHost creates a directory.
- **Public gateway** — A second gateway for Net storage (currently only storedon.net exists).
- **Consumer product** — Turns dev-facing infrastructure into something anyone can use.
- **Reference implementation** — Shows other builders how to build products on Net.

**What's the market opportunity?**
Fleek (the biggest decentralized hosting platform) shut down Jan 31, 2026. Nobody's filled the gap. We're already deeper into onchain hosting than anyone else in the Base ecosystem — exoagent.xyz has been running 13 pages onchain since February.

---

## The Technical Version

### Contract: ExoHostRegistry
- **Address**: `0x71329A553e4134dE482725f98e10A4cBd90751f7` (Base mainnet)
- **Owner**: `0x2460F6C6CA04DD6a73E9B5535aC67Ac48726c09b` (deployment wallet)
- **Standard**: ERC-721 (names are transferable NFTs)
- **Token name**: ExoHost (EXOHOST)
- **Tests**: 44 passing

### Architecture
```
User registers name ──→ ExoHostRegistry contract (Base)
                         maps name → owner + storage wallet + page keys

User uploads site   ──→ Net Protocol storage (Base)
                         same storedon.net pattern we already use

Visitor hits URL    ──→ Cloudflare Worker (exohost.xyz)
                         extracts name from subdomain
                         reads registry for wallet + keys
                         fetches from Net storage
                         serves HTML
```

### Core Data Model
```solidity
struct Site {
    address storageWallet;   // Wallet whose Net storage holds the files
    string homepageKey;      // Storage key for index page
    uint256 pageCount;       // Number of configured page routes
}

mapping(string => uint256) nameToTokenId;     // "ollie" → 1
mapping(uint256 => string) tokenIdToName;     // 1 → "ollie"
mapping(uint256 => Site) sites;               // 1 → {wallet, key, pages}
mapping(uint256 => mapping(string => string)) pageKeys;  // route → storage key
```

### Key Functions
| Function | What it does |
|----------|-------------|
| `register(name)` | Register name, mint NFT, defaults storage to sender's wallet |
| `register(name, wallet, key)` | Register with explicit storage wallet and homepage key |
| `setStorageWallet(tokenId, wallet)` | Point name at different wallet's Net storage |
| `setHomepageKey(tokenId, key)` | Change the index page storage key |
| `setPageKey(tokenId, route, key)` | Map URL path to storage key (e.g., "/about" → "mysite-about") |
| `removePageKey(tokenId, route)` | Remove a page route |
| `resolve(name)` | Returns (owner, storageWallet, homepageKey) — used by gateway |
| `resolvePage(name, route)` | Returns (storageWallet, key) for a specific page |
| `isAvailable(name)` | Check if name is taken |
| `getPrice(name)` | Get registration fee |
| `withdraw()` | Owner withdraws collected fees |

### Pricing
| Name Length | Fee |
|-------------|-----|
| 3 characters | 0.1 ETH |
| 4 characters | 0.01 ETH |
| 5+ characters | 0.001 ETH |

### Name Rules
- Lowercase a-z, 0-9, hyphens only
- 3-32 characters
- No leading or trailing hyphens
- First-come-first-served (no auctions)
- Permanent ownership (no expiration)
- Transferable (ERC-721)

### Registered Names
| Token ID | Name | Owner |
|----------|------|-------|
| 1 | ollie | 0x2460...9b07 (deployment wallet) |
| 2 | exoskeletons | 0x2460...9b07 (deployment wallet) |

### Gateway Flow (how resolution works)
```
Request: ollie.mfer.one/about

1. Worker extracts: name="ollie", route="about"
2. Worker calls: resolvePage("ollie", "about")
   → returns (0x2460..., "ollie-about")
3. Worker fetches: storedon.net/net/8453/storage/load/0x2460.../ollie-about
4. Worker serves the HTML with proper headers
5. If no page key for route, falls back to resolve("ollie") → homepageKey
```

### What's Built vs What's Next
**Done:**
- [x] ExoHostRegistry contract (deployed, 44 tests)
- [x] First names registered (ollie #1, exoskeletons #2)
- [x] Resolution verified working onchain

**Next:**
- [ ] Blockscout verification (API was down tonight, will retry)
- [ ] Modify exo-router Cloudflare Worker for multi-tenant ExoHost serving
- [x] Register mfer.one domain ($23/2yr on Porkbun)
- [ ] Build exohost CLI (`npx exohost register/deploy/status`)
- [ ] Dogfood: set up ollie.mfer.one as first live site
- [ ] Fund deploy wallet (ran out of ETH after 2 registrations)

### Cost Reality
Based on our exoagent.xyz data:
- Contract deployment: ~$0.02
- Name registration: ~$0.001 gas + fee
- Site upload (full 13-page site): ~$23 total across 440 transactions
- Biggest single page upload (44KB): $0.24
- Average page upload: ~$0.05

### Repo
`/mnt/e/Ai Agent/Projects/exohost/`
