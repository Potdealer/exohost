// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ExoHostRegistryV2
/// @notice Decentralized website naming + hosting registry on Base.
///         V2 adds onchain page storage directly on the NFT and free 5+ char names.
///         Register a name, store your HTML onchain, get a website at {name}.mfer.one.
/// @dev Names are ERC-721 NFTs. Pages stored directly on the token travel with transfers.
///      Gateway checks NFT-native pages first, falls back to Net Protocol storage.
contract ExoHostRegistryV2 is ERC721, Ownable {

    // ─── Storage ────────────────────────────────────────────────

    /// @notice Site configuration for a registered name
    struct Site {
        address storageWallet;   // Wallet whose Net Protocol storage holds the site files
        string homepageKey;      // Net Protocol storage key for the index page
        uint256 pageCount;       // Number of page routes configured
    }

    /// @notice Token ID counter (also serves as total registered count)
    uint256 public nextTokenId;

    /// @notice Name string → token ID (0 = unregistered since first token is 1)
    mapping(string => uint256) public nameToTokenId;

    /// @notice Token ID → name string
    mapping(uint256 => string) public tokenIdToName;

    /// @notice Token ID → site configuration
    mapping(uint256 => Site) public sites;

    /// @notice Token ID → page route → storage key (e.g., "about" → "mysite-about")
    mapping(uint256 => mapping(string => string)) public pageKeys;

    /// @notice Token ID → list of page route names (for enumeration)
    mapping(uint256 => string[]) public pageRoutes;

    /// @notice Token ID → onchain HTML content (stored directly on the NFT)
    mapping(uint256 => string) public pages;

    // ─── Pricing ────────────────────────────────────────────────

    /// @notice Registration fee by name length
    /// 3 chars: 0.01 ETH, 4 chars: 0.001 ETH, 5+ chars: FREE
    uint256 public constant PRICE_3_CHAR = 0.01 ether;
    uint256 public constant PRICE_4_CHAR = 0.001 ether;
    uint256 public constant PRICE_5_PLUS = 0;

    /// @notice Minimum name length
    uint256 public constant MIN_NAME_LENGTH = 3;

    /// @notice Maximum name length
    uint256 public constant MAX_NAME_LENGTH = 32;

    // ─── Events ─────────────────────────────────────────────────

    event NameRegistered(uint256 indexed tokenId, string name, address indexed owner);
    event StorageWalletUpdated(uint256 indexed tokenId, address wallet);
    event HomepageKeyUpdated(uint256 indexed tokenId, string key);
    event PageKeyUpdated(uint256 indexed tokenId, string route, string key);
    event PageKeyRemoved(uint256 indexed tokenId, string route);
    event PageUpdated(uint256 indexed tokenId);

    // ─── Errors ─────────────────────────────────────────────────

    error NameTaken();
    error NameTooShort();
    error NameTooLong();
    error InvalidCharacter();
    error InsufficientPayment();
    error NotNameOwner();
    error EmptyName();
    error EmptyKey();

    // ─── Constructor ────────────────────────────────────────────

    constructor() ERC721("ExoHost", "EXOHOST") Ownable(msg.sender) {
        nextTokenId = 1; // Start at 1 so 0 means "unregistered"
    }

    // ─── Registration ───────────────────────────────────────────

    /// @notice Register a name and mint it as an NFT
    /// @param name The name to register (lowercase alphanumeric + hyphens)
    /// @param storageWallet The wallet whose Net Protocol storage holds site files
    /// @param homepageKey The Net Protocol storage key for the index page
    function register(
        string calldata name,
        address storageWallet,
        string calldata homepageKey
    ) external payable {
        // Validate name
        _validateName(name);

        // Check availability
        if (nameToTokenId[name] != 0) revert NameTaken();

        // Check payment
        uint256 price = getPrice(name);
        if (msg.value < price) revert InsufficientPayment();

        // Mint
        uint256 tokenId = nextTokenId++;
        nameToTokenId[name] = tokenId;
        tokenIdToName[tokenId] = name;

        sites[tokenId] = Site({
            storageWallet: storageWallet,
            homepageKey: homepageKey,
            pageCount: 0
        });

        _mint(msg.sender, tokenId);

        emit NameRegistered(tokenId, name, msg.sender);

        // Refund excess
        if (msg.value > price) {
            (bool ok, ) = msg.sender.call{value: msg.value - price}("");
            require(ok);
        }
    }

    /// @notice Register a name using sender's address as storage wallet
    /// @param name The name to register
    function register(string calldata name) external payable {
        _validateName(name);
        if (nameToTokenId[name] != 0) revert NameTaken();

        uint256 price = getPrice(name);
        if (msg.value < price) revert InsufficientPayment();

        uint256 tokenId = nextTokenId++;
        nameToTokenId[name] = tokenId;
        tokenIdToName[tokenId] = name;

        sites[tokenId] = Site({
            storageWallet: msg.sender,
            homepageKey: name,  // Default: use the name as the storage key
            pageCount: 0
        });

        _mint(msg.sender, tokenId);

        emit NameRegistered(tokenId, name, msg.sender);

        if (msg.value > price) {
            (bool ok, ) = msg.sender.call{value: msg.value - price}("");
            require(ok);
        }
    }

    // ─── Site Configuration ─────────────────────────────────────

    /// @notice Update the storage wallet for a name
    function setStorageWallet(uint256 tokenId, address wallet) external {
        if (ownerOf(tokenId) != msg.sender) revert NotNameOwner();
        sites[tokenId].storageWallet = wallet;
        emit StorageWalletUpdated(tokenId, wallet);
    }

    /// @notice Update the homepage storage key
    function setHomepageKey(uint256 tokenId, string calldata key) external {
        if (ownerOf(tokenId) != msg.sender) revert NotNameOwner();
        if (bytes(key).length == 0) revert EmptyKey();
        sites[tokenId].homepageKey = key;
        emit HomepageKeyUpdated(tokenId, key);
    }

    /// @notice Set a page route → storage key mapping
    function setPageKey(uint256 tokenId, string calldata route, string calldata key) external {
        if (ownerOf(tokenId) != msg.sender) revert NotNameOwner();
        if (bytes(route).length == 0) revert EmptyName();
        if (bytes(key).length == 0) revert EmptyKey();

        // If this route is new, add to routes list
        if (bytes(pageKeys[tokenId][route]).length == 0) {
            pageRoutes[tokenId].push(route);
            sites[tokenId].pageCount++;
        }

        pageKeys[tokenId][route] = key;
        emit PageKeyUpdated(tokenId, route, key);
    }

    /// @notice Remove a page route
    function removePageKey(uint256 tokenId, string calldata route) external {
        if (ownerOf(tokenId) != msg.sender) revert NotNameOwner();
        if (bytes(pageKeys[tokenId][route]).length == 0) revert EmptyName();

        delete pageKeys[tokenId][route];
        sites[tokenId].pageCount--;
        emit PageKeyRemoved(tokenId, route);
    }

    // ─── Onchain Page Storage ───────────────────────────────────

    /// @notice Set the HTML page content directly on the NFT
    /// @dev Content travels with the token on transfer
    function setPage(uint256 tokenId, string calldata content) external {
        if (ownerOf(tokenId) != msg.sender) revert NotNameOwner();
        pages[tokenId] = content;
        emit PageUpdated(tokenId);
    }

    /// @notice Get the onchain page content for a token
    function getPage(uint256 tokenId) external view returns (string memory) {
        return pages[tokenId];
    }

    /// @notice Clear the onchain page content
    function clearPage(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotNameOwner();
        delete pages[tokenId];
        emit PageUpdated(tokenId);
    }

    // ─── Resolution (for gateway) ───────────────────────────────

    /// @notice Resolve a name to its site configuration
    function resolve(string calldata name) external view returns (
        address owner,
        address storageWallet,
        string memory homepageKey
    ) {
        uint256 tokenId = nameToTokenId[name];
        if (tokenId == 0) return (address(0), address(0), "");

        Site storage site = sites[tokenId];
        return (ownerOf(tokenId), site.storageWallet, site.homepageKey);
    }

    /// @notice Resolve a specific page route for a name
    function resolvePage(string calldata name, string calldata route) external view returns (
        address storageWallet,
        string memory key
    ) {
        uint256 tokenId = nameToTokenId[name];
        if (tokenId == 0) return (address(0), "");

        Site storage site = sites[tokenId];
        string memory pageKey = pageKeys[tokenId][route];

        if (bytes(pageKey).length == 0) {
            return (site.storageWallet, "");
        }

        return (site.storageWallet, pageKey);
    }

    // ─── Pricing ────────────────────────────────────────────────

    /// @notice Get the registration price for a name
    function getPrice(string calldata name) public pure returns (uint256) {
        uint256 len = bytes(name).length;
        if (len <= 3) return PRICE_3_CHAR;
        if (len == 4) return PRICE_4_CHAR;
        return PRICE_5_PLUS;
    }

    // ─── View Helpers ───────────────────────────────────────────

    /// @notice Check if a name is available
    function isAvailable(string calldata name) external view returns (bool) {
        return nameToTokenId[name] == 0;
    }

    /// @notice Get all page routes for a name
    function getPageRoutes(uint256 tokenId) external view returns (string[] memory) {
        return pageRoutes[tokenId];
    }

    /// @notice Get total registered names
    function totalRegistered() external view returns (uint256) {
        return nextTokenId - 1;
    }

    // ─── Admin ──────────────────────────────────────────────────

    /// @notice Withdraw collected fees
    function withdraw() external onlyOwner {
        (bool ok, ) = owner().call{value: address(this).balance}("");
        require(ok);
    }

    // ─── Internal ───────────────────────────────────────────────

    /// @notice Validate a name: lowercase a-z, 0-9, hyphens. No leading/trailing hyphens.
    function _validateName(string calldata name) internal pure {
        bytes memory b = bytes(name);
        uint256 len = b.length;

        if (len == 0) revert EmptyName();
        if (len < MIN_NAME_LENGTH) revert NameTooShort();
        if (len > MAX_NAME_LENGTH) revert NameTooLong();

        // No leading or trailing hyphens
        if (b[0] == 0x2D || b[len - 1] == 0x2D) revert InvalidCharacter();

        for (uint256 i; i < len; i++) {
            bytes1 c = b[i];
            bool valid = (c >= 0x61 && c <= 0x7A) || // a-z
                         (c >= 0x30 && c <= 0x39) || // 0-9
                         (c == 0x2D);                 // -
            if (!valid) revert InvalidCharacter();
        }
    }
}
