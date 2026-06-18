// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Script.sol";
import "../src/RiskVault.sol";

contract DeployScript is Script {
    function run() external {
        // Retrieve private key for signing deployments
        uint256 deployerPrivateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));

        // Retrieve config addresses, with testnet defaults
        address owner = vm.envOr("VAULT_OWNER", msg.sender);
        address agent = vm.envOr("VAULT_AGENT", address(0x1)); // Placeholder agent EOA for tests
        address baseAsset = vm.envOr("VAULT_BASE_ASSET", address(0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd)); // Testnet WBNB
        address router = vm.envOr("PANCAKE_ROUTER", address(0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3)); // Testnet PancakeSwap Router

        if (deployerPrivateKey != 0) {
            vm.startBroadcast(deployerPrivateKey);
        } else {
            vm.startBroadcast();
        }

        RiskVault vault = new RiskVault(
            owner,
            agent,
            baseAsset,
            router
        );

        console.log("RiskVault deployed to:", address(vault));

        vm.stopBroadcast();
    }
}
