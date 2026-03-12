import { ethers } from 'ethers';
import { REGISTRY_ADDRESS, REGISTRY_ABI, BASE_RPC, STOREDON_BASE } from './constants.js';

export function getProvider() {
  return new ethers.JsonRpcProvider(BASE_RPC);
}

export function getRegistry(providerOrSigner) {
  return new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, providerOrSigner);
}

export function getSignerFromKey(privateKey) {
  const provider = getProvider();
  return new ethers.Wallet(privateKey, provider);
}

// --- Read operations ---

export async function checkAvailability(name) {
  const registry = getRegistry(getProvider());
  const available = await registry.isAvailable(name);
  const price = await registry.getPrice(name);
  return { available, price };
}

export async function resolveName(name) {
  const registry = getRegistry(getProvider());
  const [owner, storageWallet, homepageKey] = await registry.resolve(name);
  if (owner === ethers.ZeroAddress) return null;

  const tokenId = await registry.nameToTokenId(name);
  const routes = await registry.getPageRoutes(tokenId);

  // Resolve page keys
  const pages = {};
  for (const route of routes) {
    const [, key] = await registry.resolvePage(name, route);
    pages[route] = key;
  }

  return { owner, storageWallet, homepageKey, tokenId: Number(tokenId), pages };
}

export async function getStats() {
  const registry = getRegistry(getProvider());
  const total = await registry.totalRegistered();
  return { totalRegistered: Number(total) };
}

// --- Write operations ---

export async function registerName(name, privateKey, storageWallet, homepageKey) {
  const signer = getSignerFromKey(privateKey);
  const registry = getRegistry(signer);
  const price = await registry.getPrice(name);

  let tx;
  if (storageWallet && homepageKey) {
    tx = await registry['register(string,address,string)'](name, storageWallet, homepageKey, { value: price });
  } else {
    tx = await registry['register(string)'](name, { value: price });
  }

  const receipt = await tx.wait();
  const event = receipt.logs.find(log => {
    try {
      const parsed = registry.interface.parseLog(log);
      return parsed?.name === 'NameRegistered';
    } catch { return false; }
  });

  let tokenId;
  if (event) {
    const parsed = registry.interface.parseLog(event);
    tokenId = Number(parsed.args.tokenId);
  }

  return { tx: receipt.hash, tokenId, price };
}

export async function setPageKey(tokenId, route, key, privateKey) {
  const signer = getSignerFromKey(privateKey);
  const registry = getRegistry(signer);
  const tx = await registry.setPageKey(tokenId, route, key);
  const receipt = await tx.wait();
  return { tx: receipt.hash };
}

export async function setStorageWallet(tokenId, wallet, privateKey) {
  const signer = getSignerFromKey(privateKey);
  const registry = getRegistry(signer);
  const tx = await registry.setStorageWallet(tokenId, wallet);
  const receipt = await tx.wait();
  return { tx: receipt.hash };
}

export async function setHomepageKey(tokenId, key, privateKey) {
  const signer = getSignerFromKey(privateKey);
  const registry = getRegistry(signer);
  const tx = await registry.setHomepageKey(tokenId, key);
  const receipt = await tx.wait();
  return { tx: receipt.hash };
}

// --- Content fetching ---

export async function fetchPage(name, route) {
  const registry = getRegistry(getProvider());
  let wallet, key;

  if (route) {
    [wallet, key] = await registry.resolvePage(name, route);
    // Fall back to homepage if no specific page key
    if (!key) {
      const [, w, k] = await registry.resolve(name);
      wallet = w;
      key = k;
    }
  } else {
    const [, w, k] = await registry.resolve(name);
    wallet = w;
    key = k;
  }

  if (!wallet || wallet === ethers.ZeroAddress) return null;

  const url = `${STOREDON_BASE}/${wallet}/${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}
