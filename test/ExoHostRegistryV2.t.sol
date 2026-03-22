// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ExoHostRegistryV2.sol";

contract ExoHostRegistryV2Test is Test {
    ExoHostRegistryV2 public registry;

    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        registry = new ExoHostRegistryV2();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ─── Registration (same as V1) ────────────────────────────────

    function test_RegisterSimple() public {
        vm.prank(alice);
        registry.register("mysite");

        assertEq(registry.ownerOf(1), alice);
        assertEq(registry.nameToTokenId("mysite"), 1);
        assertEq(registry.tokenIdToName(1), "mysite");
        assertEq(registry.totalRegistered(), 1);
    }

    function test_RegisterWithConfig() public {
        vm.prank(alice);
        registry.register("mysite", bob, "index-page");

        (address siteOwner, address wallet, string memory key) = registry.resolve("mysite");
        assertEq(siteOwner, alice);
        assertEq(wallet, bob);
        assertEq(key, "index-page");
    }

    function test_RegisterEmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, true, true);
        emit ExoHostRegistryV2.NameRegistered(1, "mysite", alice);
        registry.register("mysite");
    }

    // ─── New Pricing ──────────────────────────────────────────────

    function test_Price3Char() public view {
        assertEq(registry.getPrice("abc"), 0.01 ether);
    }

    function test_Price4Char() public view {
        assertEq(registry.getPrice("abcd"), 0.001 ether);
    }

    function test_Price5PlusFree() public view {
        assertEq(registry.getPrice("abcde"), 0);
        assertEq(registry.getPrice("longer-name"), 0);
    }

    function test_Register5PlusFreeNoPayment() public {
        vm.prank(alice);
        registry.register("mysite"); // 6 chars, should be free
        assertEq(registry.ownerOf(1), alice);
    }

    function test_Register5PlusFreeWithConfig() public {
        vm.prank(alice);
        registry.register("mysite", bob, "index-page"); // 6 chars, free
        assertEq(registry.ownerOf(1), alice);
    }

    function test_Register4CharRequiresPayment() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistryV2.InsufficientPayment.selector);
        registry.register("abcd"); // 4 chars, needs 0.001 ETH
    }

    function test_Register4CharWithPayment() public {
        vm.prank(alice);
        registry.register{value: 0.001 ether}("abcd");
        assertEq(registry.ownerOf(1), alice);
    }

    function test_Register3CharRequiresPayment() public {
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistryV2.InsufficientPayment.selector);
        registry.register{value: 0.001 ether}("abc"); // 3 chars, needs 0.01 ETH
    }

    function test_Register3CharWithPayment() public {
        vm.prank(alice);
        registry.register{value: 0.01 ether}("abc");
        assertEq(registry.ownerOf(1), alice);
    }

    function test_RegisterRefundsExcess() public {
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        registry.register{value: 1 ether}("abcd");
        uint256 balAfter = alice.balance;
        assertEq(balBefore - balAfter, 0.001 ether);
    }

    // ─── Onchain Page Storage ─────────────────────────────────────

    function test_SetPage() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.prank(alice);
        registry.setPage(1, "<html><body>hello world</body></html>");

        string memory content = registry.getPage(1);
        assertEq(content, "<html><body>hello world</body></html>");
    }

    function test_SetPageEmitsEvent() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit ExoHostRegistryV2.PageUpdated(1);
        registry.setPage(1, "<html>test</html>");
    }

    function test_SetPageNonOwnerReverts() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.prank(bob);
        vm.expectRevert(ExoHostRegistryV2.NotNameOwner.selector);
        registry.setPage(1, "<html>hacked</html>");
    }

    function test_GetPageReturnsStoredContent() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.prank(alice);
        registry.setPage(1, "<h1>gm</h1>");

        assertEq(registry.getPage(1), "<h1>gm</h1>");
    }

    function test_GetPageEmptyByDefault() public {
        vm.prank(alice);
        registry.register("mysite");

        string memory content = registry.getPage(1);
        assertEq(bytes(content).length, 0);
    }

    function test_ClearPage() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.startPrank(alice);
        registry.setPage(1, "<html>content</html>");
        registry.clearPage(1);
        vm.stopPrank();

        string memory content = registry.getPage(1);
        assertEq(bytes(content).length, 0);
    }

    function test_ClearPageEmitsEvent() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.startPrank(alice);
        registry.setPage(1, "<html>content</html>");

        vm.expectEmit(true, false, false, false);
        emit ExoHostRegistryV2.PageUpdated(1);
        registry.clearPage(1);
        vm.stopPrank();
    }

    function test_ClearPageNonOwnerReverts() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.prank(alice);
        registry.setPage(1, "<html>content</html>");

        vm.prank(bob);
        vm.expectRevert(ExoHostRegistryV2.NotNameOwner.selector);
        registry.clearPage(1);
    }

    function test_SetPageOverwritesPrevious() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.startPrank(alice);
        registry.setPage(1, "<html>v1</html>");
        registry.setPage(1, "<html>v2</html>");
        vm.stopPrank();

        assertEq(registry.getPage(1), "<html>v2</html>");
    }

    function test_PageTransfersWithToken() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.prank(alice);
        registry.setPage(1, "<html>alice's page</html>");

        // Transfer to bob
        vm.prank(alice);
        registry.transferFrom(alice, bob, 1);

        // Page content still there, readable by anyone
        assertEq(registry.getPage(1), "<html>alice's page</html>");

        // New owner (bob) can update it
        vm.prank(bob);
        registry.setPage(1, "<html>bob's page now</html>");
        assertEq(registry.getPage(1), "<html>bob's page now</html>");

        // Old owner (alice) cannot update it
        vm.prank(alice);
        vm.expectRevert(ExoHostRegistryV2.NotNameOwner.selector);
        registry.setPage(1, "<html>alice tries again</html>");
    }

    // ─── Existing functionality still works ───────────────────────

    function test_SetStorageWallet() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.prank(alice);
        registry.setStorageWallet(1, bob);

        (, address wallet,) = registry.resolve("mysite");
        assertEq(wallet, bob);
    }

    function test_SetPageKey() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.prank(alice);
        registry.setPageKey(1, "about", "mysite-about");

        (address wallet, string memory key) = registry.resolvePage("mysite", "about");
        assertEq(wallet, alice);
        assertEq(key, "mysite-about");
    }

    function test_IsAvailable() public {
        assertTrue(registry.isAvailable("mysite"));

        vm.prank(alice);
        registry.register("mysite");

        assertFalse(registry.isAvailable("mysite"));
    }

    function test_NameValidation() public {
        vm.startPrank(alice);

        vm.expectRevert(ExoHostRegistryV2.NameTooShort.selector);
        registry.register("ab");

        vm.expectRevert(ExoHostRegistryV2.InvalidCharacter.selector);
        registry.register("MySite");

        vm.expectRevert(ExoHostRegistryV2.InvalidCharacter.selector);
        registry.register("-mysite");

        vm.stopPrank();
    }

    function test_Withdraw() public {
        vm.prank(alice);
        registry.register{value: 0.01 ether}("abc");
        vm.prank(bob);
        registry.register{value: 0.001 ether}("abcd");

        uint256 balBefore = owner.balance;
        registry.withdraw();
        uint256 balAfter = owner.balance;

        assertEq(balAfter - balBefore, 0.011 ether);
    }

    function test_TransferName() public {
        vm.prank(alice);
        registry.register("mysite");

        vm.prank(alice);
        registry.transferFrom(alice, bob, 1);

        assertEq(registry.ownerOf(1), bob);
        (address siteOwner,,) = registry.resolve("mysite");
        assertEq(siteOwner, bob);
    }

    receive() external payable {}
}
