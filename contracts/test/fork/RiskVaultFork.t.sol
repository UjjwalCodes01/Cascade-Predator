// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import "../../src/RiskVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RiskVaultForkTest is Test {
    RiskVault public vault;

    // BSC Mainnet Addresses
    address public constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address public constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address public constant CAKE = 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82;
    address public constant UNSAFE_TOKEN = 0x8F55730E0f0D8E9D0219C4EDCdFa7d2364cCcF88; // Random un-allowlisted address

    address public owner = address(0xAA);
    address public agent = address(0xBB);
    address public stranger = address(0xCC);

    error OwnableInvalidOwner(address owner);

    function setUp() public {
        // Retrieve the fork URL. If not set, default to a public BSC RPC.
        string memory rpcUrl = vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.binance.org/"));
        
        // Create fork
        vm.createSelectFork(rpcUrl);

        // Deploy RiskVault
        vm.prank(owner);
        vault = new RiskVault(
            owner,
            agent,
            WBNB,
            PANCAKE_ROUTER
        );

        // Allowlist WBNB, USDT, and CAKE
        address[] memory tokens = new address[](3);
        tokens[0] = WBNB;
        tokens[1] = USDT;
        tokens[2] = CAKE;
        bool[] memory statuses = new bool[](3);
        statuses[0] = true;
        statuses[1] = true;
        statuses[2] = true;

        vm.prank(owner);
        vault.setAllowlist(tokens, statuses);

        // Fund the vault with some WBNB (using forge deal)
        deal(WBNB, address(vault), 10 ether);
    }

    // ==========================================
    //           Fork Integration Tests
    // ==========================================

    function testFork_AgentCanSwapWBNBForUSDT() public {
        address[] memory path = new address[](2);
        path[0] = WBNB;
        path[1] = USDT;

        uint256 swapAmount = 0.5 ether; // 0.5 WBNB (within 10% cap of 10 ether)
        uint256 balanceBeforeWBNB = IERC20(WBNB).balanceOf(address(vault));
        uint256 balanceBeforeUSDT = IERC20(USDT).balanceOf(address(vault));

        // Execute Swap
        vm.prank(agent);
        vault.executeSwap(swapAmount, 1, path, block.timestamp + 300);

        uint256 balanceAfterWBNB = IERC20(WBNB).balanceOf(address(vault));
        uint256 balanceAfterUSDT = IERC20(USDT).balanceOf(address(vault));

        assertEq(balanceAfterWBNB, balanceBeforeWBNB - swapAmount);
        assertTrue(balanceAfterUSDT > balanceBeforeUSDT, "USDT balance did not increase");
        assertEq(vault.dailyCount(), 1);
        assertEq(vault.dailyVolume(), swapAmount);
    }

    function testFork_AgentCanSwapUSDTBackToWBNB() public {
        // Step 1: Swap WBNB -> USDT
        address[] memory path = new address[](2);
        path[0] = WBNB;
        path[1] = USDT;

        vm.prank(agent);
        vault.executeSwap(0.5 ether, 1, path, block.timestamp + 300);

        uint256 usdtBalance = IERC20(USDT).balanceOf(address(vault));
        assertTrue(usdtBalance > 0, "No USDT received");

        // Step 2: Swap USDT -> WBNB
        address[] memory reversePath = new address[](2);
        reversePath[0] = USDT;
        reversePath[1] = WBNB;

        uint256 wbnbBefore = IERC20(WBNB).balanceOf(address(vault));

        vm.prank(agent);
        vault.executeSwap(usdtBalance / 10, 1, reversePath, block.timestamp + 300);

        uint256 wbnbAfter = IERC20(WBNB).balanceOf(address(vault));
        assertTrue(wbnbAfter > wbnbBefore, "WBNB balance did not increase after exit");
    }

    function testFork_SwapRevertsOnSlippage() public {
        address[] memory path = new address[](2);
        path[0] = WBNB;
        path[1] = USDT;

        // Require 1,000,000 USDT for 0.5 WBNB (which will obviously fail slippage checks)
        uint256 swapAmount = 0.5 ether;
        uint256 unrealisticOutMin = 1_000_000 * 1e18; 

        vm.prank(agent);
        vm.expectRevert(); // PancakeRouter will revert due to slippage
        vault.executeSwap(swapAmount, unrealisticOutMin, path, block.timestamp + 300);
    }

    function testFork_SwapRevertsForUnlistedToken() public {
        address[] memory path = new address[](2);
        path[0] = WBNB;
        path[1] = UNSAFE_TOKEN;

        uint256 swapAmount = 0.5 ether;

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(RiskVault.OffAllowlist.selector, UNSAFE_TOKEN)
        );
        vault.executeSwap(swapAmount, 1, path, block.timestamp + 300);
    }

    function testFork_WithdrawToOwner() public {
        uint256 vaultWbnbBefore = IERC20(WBNB).balanceOf(address(vault));
        uint256 ownerWbnbBefore = IERC20(WBNB).balanceOf(owner);

        vm.prank(owner);
        vault.withdraw(WBNB, 5 ether);

        assertEq(IERC20(WBNB).balanceOf(address(vault)), vaultWbnbBefore - 5 ether);
        assertEq(IERC20(WBNB).balanceOf(owner), ownerWbnbBefore + 5 ether);
    }
}
