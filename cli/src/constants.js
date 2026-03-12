export const REGISTRY_ADDRESS = '0x71329A553e4134dE482725f98e10A4cBd90751f7';
export const BASE_RPC = 'https://base-rpc.publicnode.com';
export const BASE_CHAIN_ID = 8453;
export const STOREDON_BASE = 'https://storedon.net/net/8453/storage/load';
export const NET_STORAGE_CONTRACT = '0x000000000000b6b14f74acae397cbebc5d4e1bbe';

export const REGISTRY_ABI = [
  'function register(string name) payable',
  'function register(string name, address storageWallet, string homepageKey) payable',
  'function resolve(string name) view returns (address owner, address storageWallet, string homepageKey)',
  'function resolvePage(string name, string route) view returns (address storageWallet, string key)',
  'function isAvailable(string name) view returns (bool)',
  'function getPrice(string name) view returns (uint256)',
  'function setStorageWallet(uint256 tokenId, address wallet)',
  'function setHomepageKey(uint256 tokenId, string key)',
  'function setPageKey(uint256 tokenId, string route, string key)',
  'function removePageKey(uint256 tokenId, string route)',
  'function getPageRoutes(uint256 tokenId) view returns (string[])',
  'function nameToTokenId(string name) view returns (uint256)',
  'function tokenIdToName(uint256 tokenId) view returns (string)',
  'function totalRegistered() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event NameRegistered(uint256 indexed tokenId, string name, address indexed owner)'
];

// Net Protocol storage ABI (for deploying sites)
export const NET_STORAGE_ABI = [
  'function store(bytes32 key, bytes value)',
  'function load(bytes32 key) view returns (bytes)'
];
