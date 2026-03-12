// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ExoHostRegistry.sol";

contract ExoHostRegistryTest is Test {
    ExoHostRegistry public registry;

    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        registry = new ExoHostRegistry();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ─── Registration ───────────────────────────────────────────

    function test_RegisterSimple() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        assertEq(registry.ownerOf(1), alice);
        assertEq(registry.nameToTokenId("mysite"), 1);
        assertEq(registry.tokenIdToName(1), "mysite");
        assertEq(registry.totalRegistered(), 1);
    }

    function test_RegisterWithConfig() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite", bob, "index-page");

        (address siteOwner, address wallet, string memory key) = registry.resolve("mysite");
        assertEq(siteOwner, alice);
        assertEq(wallet, bob);
        assertEq(key, "index-page");
    }

    function test_RegisterDefaultsToSenderWallet() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("coolsite");

        (, address wallet, string memory key) = registry.resolve("coolsite");
        assertEq(wallet, alice);
        assertEq(key, "coolsite"); // Default key = name
    }

    function test_RegisterMintsNFT() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        assertEq(registry.balanceOf(alice), 1);
        assertEq(registry.ownerOf(1), alice);
    }

    function test_RegisterMultiple() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("site-one");
        vm.prank(bob);
        registry.register{value: 0.001 ether}("site-two");

        assertEq(registry.totalRegistered(), 2);
        assertEq(registry.ownerOf(1), alice);
        assertEq(registry.ownerOf(2), bob);
    }

    function test_RegisterEmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, true, true);
        emit ExoHostRegistry.NameRegistered(1, "mysite", alice);
        registry.register{value: 0.001 ether}("mysite");
    }

    function test_RegisterRefundsExcess() public {
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        registry.register{value: 1 ether}("mysite");
        uint256 balAfter = alice.balance;

        // Should only charge 0.001 ETH, refund the rest
        assertEq(balBefore - balAfter, 0.001 ether);
    }

    // ─── Pricing ────────────────────────────────────────────────

    function test_Price3Char() public view {
        assertEq(registry.getPrice("abc"), 0.1 ether);
    }

    function test_Price4Char() public view {
        assertEq(registry.getPrice("abcd"), 0.01 ether);
    }

    function test_Price5Plus() public view {
        assertEq(registry.getPrice("abcde"), 0.001 ether);
        assertEq(registry.getPrice("longer-name"), 0.001 ether);
    }

    function test_RevertInsufficientPayment() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.InsufficientPayment.selector);
        registry.register{value: 0.0001 ether}("mysite");
    }

    function test_RevertInsufficientPayment3Char() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.InsufficientPayment.selector);
        registry.register{value: 0.01 ether}("abc");
    }

    // ─── Name Validation ────────────────────────────────────────

    function test_RevertNameTaken() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(bob);
        vm.expectRevert(ExoHostRegistry.NameTaken.selector);
        registry.register{value: 0.001 ether}("mysite");
    }

    function test_RevertNameTooShort() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.NameTooShort.selector);
        registry.register{value: 0.1 ether}("ab");
    }

    function test_RevertNameTooLong() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.NameTooLong.selector);
        registry.register{value: 0.001 ether}("abcdefghijklmnopqrstuvwxyz1234567");
    }

    function test_RevertUppercase() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.InvalidCharacter.selector);
        registry.register{value: 0.001 ether}("MySite");
    }

    function test_RevertSpaces() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.InvalidCharacter.selector);
        registry.register{value: 0.001 ether}("my site");
    }

    function test_RevertLeadingHyphen() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.InvalidCharacter.selector);
        registry.register{value: 0.001 ether}("-mysite");
    }

    function test_RevertTrailingHyphen() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.InvalidCharacter.selector);
        registry.register{value: 0.001 ether}("mysite-");
    }

    function test_RevertSpecialChars() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.InvalidCharacter.selector);
        registry.register{value: 0.001 ether}("my_site");
    }

    function test_AllowHyphensInMiddle() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("my-cool-site");
        assertEq(registry.ownerOf(1), alice);
    }

    function test_AllowNumbers() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("site123");
        assertEq(registry.ownerOf(1), alice);
    }

    function test_AllowAllNumbers() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("12345");
        assertEq(registry.ownerOf(1), alice);
    }

    function test_Allow32CharName() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("abcdefghijklmnopqrstuvwxyz123456");
        assertEq(registry.ownerOf(1), alice);
    }

    // ─── Site Configuration ─────────────────────────────────────

    function test_SetStorageWallet() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(alice);
        registry.setStorageWallet(1, bob);

        (, address wallet,) = registry.resolve("mysite");
        assertEq(wallet, bob);
    }

    function test_SetHomepageKey() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(alice);
        registry.setHomepageKey(1, "new-index");

        (,, string memory key) = registry.resolve("mysite");
        assertEq(key, "new-index");
    }

    function test_SetPageKey() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(alice);
        registry.setPageKey(1, "about", "mysite-about");

        (address wallet, string memory key) = registry.resolvePage("mysite", "about");
        assertEq(wallet, alice);
        assertEq(key, "mysite-about");
    }

    function test_SetMultiplePageKeys() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.startPrank(alice);
        registry.setPageKey(1, "about", "mysite-about");
        registry.setPageKey(1, "projects", "mysite-projects");
        registry.setPageKey(1, "contact", "mysite-contact");
        vm.stopPrank();

        string[] memory routes = registry.getPageRoutes(1);
        assertEq(routes.length, 3);
    }

    function test_RemovePageKey() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.startPrank(alice);
        registry.setPageKey(1, "about", "mysite-about");
        registry.removePageKey(1, "about");
        vm.stopPrank();

        (, string memory key) = registry.resolvePage("mysite", "about");
        assertEq(bytes(key).length, 0);
    }

    function test_RevertNotOwnerSetWallet() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(bob);
        vm.expectRevert(ExoHostRegistry.NotNameOwner.selector);
        registry.setStorageWallet(1, bob);
    }

    function test_RevertNotOwnerSetPageKey() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(bob);
        vm.expectRevert(ExoHostRegistry.NotNameOwner.selector);
        registry.setPageKey(1, "about", "mysite-about");
    }

    function test_RevertEmptyHomepageKey() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.EmptyKey.selector);
        registry.setHomepageKey(1, "");
    }

    // ─── Resolution ─────────────────────────────────────────────

    function test_ResolveUnregistered() public view {
        (address siteOwner, address wallet, string memory key) = registry.resolve("nonexistent");
        assertEq(siteOwner, address(0));
        assertEq(wallet, address(0));
        assertEq(bytes(key).length, 0);
    }

    function test_ResolvePageUnregistered() public view {
        (address wallet, string memory key) = registry.resolvePage("nonexistent", "about");
        assertEq(wallet, address(0));
        assertEq(bytes(key).length, 0);
    }

    function test_ResolvePageNoRoute() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        (address wallet, string memory key) = registry.resolvePage("mysite", "nonexistent");
        assertEq(wallet, alice);
        assertEq(bytes(key).length, 0); // Empty = gateway falls back to homepage
    }

    // ─── Availability ───────────────────────────────────────────

    function test_IsAvailable() public {
        assertTrue(registry.isAvailable("mysite"));

        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        assertFalse(registry.isAvailable("mysite"));
    }

    // ─── Transfer ───────────────────────────────────────────────

    function test_TransferName() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(alice);
        registry.transferFrom(alice, bob, 1);

        assertEq(registry.ownerOf(1), bob);

        // Resolution still works, now bob is owner
        (address siteOwner,,) = registry.resolve("mysite");
        assertEq(siteOwner, bob);
    }

    function test_NewOwnerCanUpdateConfig() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(alice);
        registry.transferFrom(alice, bob, 1);

        // Bob can now update the site
        vm.prank(bob);
        registry.setStorageWallet(1, bob);

        (, address wallet,) = registry.resolve("mysite");
        assertEq(wallet, bob);
    }

    function test_OldOwnerCantUpdateAfterTransfer() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(alice);
        registry.transferFrom(alice, bob, 1);

        // Alice can no longer update
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistry.NotNameOwner.selector);
        registry.setStorageWallet(1, alice);
    }

    // ─── Admin ──────────────────────────────────────────────────

    function test_Withdraw() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");
        vm.prank(bob);
        registry.register{value: 0.001 ether}("bobsite");

        uint256 balBefore = owner.balance;
        registry.withdraw();
        uint256 balAfter = owner.balance;

        assertEq(balAfter - balBefore, 0.002 ether);
    }

    function test_RevertWithdrawNotOwner() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.prank(alice);
        vm.expectRevert();
        registry.withdraw();
    }

    // ─── ERC-721 Metadata ───────────────────────────────────────

    function test_TokenName() public view {
        assertEq(registry.name(), "ExoHost");
        assertEq(registry.symbol(), "EXOHOST");
    }

    // ─── Edge Cases ─────────────────────────────────────────────

    function test_Exactly3CharPricing() public {
        vm.prank(alice);
        registry.register{value: 0.1 ether}("abc");
        assertEq(registry.ownerOf(1), alice);
    }

    function test_UpdatePageKeyOverwrite() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("mysite");

        vm.startPrank(alice);
        registry.setPageKey(1, "about", "old-key");
        registry.setPageKey(1, "about", "new-key");
        vm.stopPrank();

        (, string memory key) = registry.resolvePage("mysite", "about");
        assertEq(key, "new-key");

        // Should not have duplicate routes
        string[] memory routes = registry.getPageRoutes(1);
        assertEq(routes.length, 1);
    }

    receive() external payable {}
}
