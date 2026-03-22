// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ExoHostRegistryV2.sol";

/// @notice Deploy ExoHostRegistryV2 to Base mainnet.
///         V1 (0x71329A553e4134dE482725f98e10A4cBd90751f7) is not upgradeable,
///         so this deploys a fresh contract. The 2 existing V1 names (ollie, exoskeletons)
///         need to be re-registered manually on V2 after deployment.
///
/// Usage:
///   forge script script/DeployV2.s.sol:DeployV2 \
///     --rpc-url https://base-rpc.publicnode.com \
///     --broadcast --verify \
///     --etherscan-api-key $BASESCAN_API_KEY \
///     --private-key $DEPLOYER_PRIVATE_KEY
contract DeployV2 is Script {
    function run() external {
        vm.startBroadcast();

        ExoHostRegistryV2 registry = new ExoHostRegistryV2();

        console.log("ExoHostRegistryV2 deployed at:", address(registry));
        console.log("Owner:", registry.owner());
        console.log("");
        console.log("Next steps:");
        console.log("  1. Verify on Basescan (should auto-verify with --verify flag)");
        console.log("  2. Re-register 'ollie' and 'exoskeletons' (free, 5+ chars)");
        console.log("  3. Update cloudflare-worker.js with new V2 address");
        console.log("  4. Update MEMORY.md with new contract address");

        vm.stopBroadcast();
    }
}
