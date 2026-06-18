// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Script.sol";
import "../src/RiskVault.sol";

contract SetAllowlistScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        address vaultAddress = vm.envOr("VAULT_ADDRESS", address(0));

        require(vaultAddress != address(0), "VAULT_ADDRESS env var must be set");

        // Read the token addresses list
        string memory jsonPath = "../config/token-allowlist-addresses.json";
        string memory json = vm.readFile(jsonPath);
        address[] memory addresses = abi.decode(vm.parseJson(json), (address[]));

        uint256 total = addresses.length;
        console.log("Loaded %s addresses from config", total);

        RiskVault vault = RiskVault(payable(vaultAddress));

        if (deployerPrivateKey != 0) {
            vm.startBroadcast(deployerPrivateKey);
        } else {
            vm.startBroadcast();
        }

        uint256 batchSize = 30;
        for (uint256 i = 0; i < total; i += batchSize) {
            uint256 end = i + batchSize;
            if (end > total) {
                end = total;
            }
            uint256 currentBatchSize = end - i;

            address[] memory batchAddresses = new address[](currentBatchSize);
            bool[] memory batchStatuses = new bool[](currentBatchSize);

            for (uint256 j = 0; j < currentBatchSize; j++) {
                batchAddresses[j] = addresses[i + j];
                batchStatuses[j] = true;
            }

            console.log("Setting allowlist batch: index %s to %s", i, end - 1);
            vault.setAllowlist(batchAddresses, batchStatuses);
        }

        vm.stopBroadcast();
        console.log("Successfully set allowlist on-chain!");
    }
}
