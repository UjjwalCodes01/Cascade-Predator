// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import "../src/RiskVault.sol";
import "../src/interfaces/IPancakeRouter02.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// --- Mock ERC20 Token ---
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// --- Mock PancakeRouter ---
contract MockRouter is IPancakeRouter02 {
    uint256 public swapRate = 1;

    function setSwapRate(uint256 _rate) external {
        swapRate = _rate;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external override returns (uint256[] memory amounts) {
        address tIn = path[0];
        address tOut = path[path.length - 1];

        // Transfer tokenIn from vault (msg.sender) to router
        IERC20(tIn).transferFrom(msg.sender, address(this), amountIn);

        // Calculate output amount
        uint256 amountOut = amountIn * swapRate;
        require(amountOut >= amountOutMin, "MockRouter: Slippage check failed");

        // Mint or transfer tokenOut to the recipient
        // In our tests, the mock router will already be funded with tokenOut
        IERC20(tOut).transfer(to, amountOut);

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;
    }
}

contract RiskVaultTest is Test {
    RiskVault public vault;
    MockRouter public router;
    MockERC20 public wbnb;
    MockERC20 public cake;
    MockERC20 public unsafeToken;

    address public owner = address(0xAA);
    address public agent = address(0xBB);
    address public stranger = address(0xCC);

    // Declaring expected events locally to use with expectEmit
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event RiskParamsUpdated(uint256 maxPositionBps, uint256 dailyVolumeCap, uint256 dailyCountCap);
    event AllowlistUpdated(address indexed token, bool status);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event FundsWithdrawn(address indexed token, address indexed to, uint256 amount);
    error OwnableInvalidOwner(address owner);

    function setUp() public {
        // Deploy mock assets
        wbnb = new MockERC20("Wrapped BNB", "WBNB");
        cake = new MockERC20("PancakeSwap Token", "CAKE");
        unsafeToken = new MockERC20("Malicious Token", "BAD");

        // Deploy mock router
        router = new MockRouter();

        // Deploy RiskVault
        vm.prank(owner);
        vault = new RiskVault(
            owner,
            agent,
            address(wbnb),
            address(router)
        );

        // Fund the vault with WBNB
        wbnb.mint(address(vault), 1000 ether);

        // Fund the MockRouter with CAKE to satisfy swaps
        cake.mint(address(router), 10000 ether);
        wbnb.mint(address(router), 10000 ether);

        // Set allowlist for WBNB and CAKE
        address[] memory tokens = new address[](2);
        tokens[0] = address(wbnb);
        tokens[1] = address(cake);
        bool[] memory statuses = new bool[](2);
        statuses[0] = true;
        statuses[1] = true;

        vm.prank(owner);
        vault.setAllowlist(tokens, statuses);
    }

    // ==========================================
    //           1. Constructor & Initialization
    // ==========================================

    function test_Initialization() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.agent(), agent);
        assertEq(vault.baseAsset(), address(wbnb));
        assertEq(vault.pancakeRouter(), address(router));
        assertEq(vault.maxPositionBps(), 1000); // 10%
        assertTrue(vault.isAllowlisted(address(wbnb)));
        assertTrue(vault.isAllowlisted(address(cake)));
        assertFalse(vault.isAllowlisted(address(unsafeToken)));
    }

    function test_ConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(
            abi.encodeWithSelector(OwnableInvalidOwner.selector, address(0))
        );
        new RiskVault(address(0), agent, address(wbnb), address(router));

        vm.expectRevert(RiskVault.InvalidAddress.selector);
        new RiskVault(owner, address(0), address(wbnb), address(router));
    }

    // ==========================================
    //           2. Ownership & Access Control
    // ==========================================

    function test_OwnerCanSetAgent() public {
        address newAgent = address(0xDD);
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit AgentUpdated(agent, newAgent);
        vault.setAgent(newAgent);
        assertEq(vault.agent(), newAgent);
    }

    function test_StrangerCannotSetAgent() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger)
        );
        vault.setAgent(stranger);
    }

    function test_OwnerCanSetRiskParams() public {
        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit RiskParamsUpdated(2000, 100 ether, 20);
        vault.setRiskParams(2000, 100 ether, 20);
        assertEq(vault.maxPositionBps(), 2000);
        assertEq(vault.dailyVolumeCap(), 100 ether);
        assertEq(vault.dailyCountCap(), 20);
    }

    function test_SetRiskParamsRevertsOnInvalidBps() public {
        vm.prank(owner);
        vm.expectRevert(RiskVault.InvalidBps.selector);
        vault.setRiskParams(10001, 100 ether, 20);
    }

    function test_OwnerCanSetAllowlist() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(unsafeToken);
        bool[] memory statuses = new bool[](1);
        statuses[0] = true;

        vm.prank(owner);
        vault.setAllowlist(tokens, statuses);
        assertTrue(vault.isAllowlisted(address(unsafeToken)));
    }

    function test_SetAllowlistRevertsOnLengthMismatch() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(unsafeToken);
        tokens[1] = address(0x1);
        bool[] memory statuses = new bool[](1);
        statuses[0] = true;

        vm.prank(owner);
        vm.expectRevert(RiskVault.InvalidAllowlistParams.selector);
        vault.setAllowlist(tokens, statuses);
    }

    // ==========================================
    //           3. Pause / Unpause
    // ==========================================

    function test_OwnerCanPauseAndUnpause() public {
        vm.startPrank(owner);
        vault.pause();
        assertTrue(vault.paused());

        // Agent swap should revert when paused
        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(cake);

        vm.stopPrank();
        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.executeSwap(10 ether, 9 ether, path, block.timestamp + 60);

        vm.prank(owner);
        vault.unpause();
        assertFalse(vault.paused());
    }

    // ==========================================
    //           4. Owner Withdrawals
    // ==========================================

    function test_OwnerCanWithdrawERC20() public {
        uint256 initialOwnerBalance = wbnb.balanceOf(owner);
        uint256 initialVaultBalance = wbnb.balanceOf(address(vault));

        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        emit FundsWithdrawn(address(wbnb), owner, 100 ether);
        vault.withdraw(address(wbnb), 100 ether);

        assertEq(wbnb.balanceOf(owner), initialOwnerBalance + 100 ether);
        assertEq(wbnb.balanceOf(address(vault)), initialVaultBalance - 100 ether);
    }

    function test_OwnerCanWithdrawNativeBNB() public {
        // Send native BNB to vault
        vm.deal(address(vault), 10 ether);
        uint256 initialOwnerBalance = owner.balance;

        vm.prank(owner);
        vault.withdraw(address(0), 5 ether);

        assertEq(owner.balance, initialOwnerBalance + 5 ether);
        assertEq(address(vault).balance, 5 ether);
    }

    function test_StrangerCannotWithdraw() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger)
        );
        vault.withdraw(address(wbnb), 100 ether);
    }

    // ==========================================
    //           5. Agent Swap Execution
    // ==========================================

    function test_AgentCanExecuteSwapWithinLimits() public {
        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(cake);

        uint256 swapAmount = 10 ether; // Within 10% of 1000 WBNB balance (100 WBNB max)
        
        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(address(wbnb), address(cake), swapAmount, swapAmount);
        vault.executeSwap(swapAmount, swapAmount, path, block.timestamp + 60);

        assertEq(wbnb.balanceOf(address(vault)), 1000 ether - swapAmount);
        assertEq(cake.balanceOf(address(vault)), swapAmount);
        assertEq(vault.dailyCount(), 1);
        assertEq(vault.dailyVolume(), swapAmount);
    }

    function test_SwapRevertsForStranger() public {
        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(cake);

        vm.prank(stranger);
        vm.expectRevert(RiskVault.UnauthorizedAgent.selector);
        vault.executeSwap(10 ether, 9 ether, path, block.timestamp + 60);
    }

    function test_SwapRevertsForNonAllowlistedToken() public {
        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(unsafeToken);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(RiskVault.OffAllowlist.selector, address(unsafeToken)));
        vault.executeSwap(10 ether, 9 ether, path, block.timestamp + 60);
    }

    function test_SwapRevertsIfPositionCapExceeded() public {
        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(cake);

        // Max position size is 10% of 1000 WBNB = 100 WBNB
        uint256 swapAmount = 101 ether;

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(RiskVault.ExceedsPositionCap.selector, swapAmount, 100 ether)
        );
        vault.executeSwap(swapAmount, 90 ether, path, block.timestamp + 60);
    }

    function test_SwapRevertsIfDailyCountCapExceeded() public {
        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(cake);

        vm.prank(owner);
        vault.setRiskParams(1000, 500 ether, 2); // Set count cap to 2

        vm.startPrank(agent);
        vault.executeSwap(10 ether, 10 ether, path, block.timestamp + 60);
        vault.executeSwap(10 ether, 10 ether, path, block.timestamp + 60);

        // 3rd swap should revert
        vm.expectRevert(
            abi.encodeWithSelector(RiskVault.ExceedsDailyCountCap.selector, 3, 2)
        );
        vault.executeSwap(10 ether, 10 ether, path, block.timestamp + 60);
        vm.stopPrank();
    }

    function test_SwapRevertsIfDailyVolumeCapExceeded() public {
        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(cake);

        vm.prank(owner);
        vault.setRiskParams(2000, 30 ether, 10); // Set volume cap to 30 WBNB

        vm.startPrank(agent);
        vault.executeSwap(20 ether, 20 ether, path, block.timestamp + 60);

        // Next 15 WBNB swap exceeds 30 WBNB limit (20 + 15 = 35)
        vm.expectRevert(
            abi.encodeWithSelector(RiskVault.ExceedsDailyVolumeCap.selector, 15 ether, 20 ether, 30 ether)
        );
        vault.executeSwap(15 ether, 15 ether, path, block.timestamp + 60);
        vm.stopPrank();
    }

    function test_DailyResetLogic() public {
        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(cake);

        vm.prank(owner);
        vault.setRiskParams(2000, 30 ether, 2); // Count cap 2, volume cap 30 WBNB

        vm.startPrank(agent);
        vault.executeSwap(15 ether, 15 ether, path, block.timestamp + 60);
        vault.executeSwap(10 ether, 10 ether, path, block.timestamp + 60);
        
        // Count cap hit (2/2). Swap 3 fails.
        vm.expectRevert(
            abi.encodeWithSelector(RiskVault.ExceedsDailyCountCap.selector, 3, 2)
        );
        vault.executeSwap(1 ether, 1 ether, path, block.timestamp + 60);

        // Warp time forward by 1 day
        vm.warp(block.timestamp + 1 days + 1);

        // Should succeed now as limits reset
        vault.executeSwap(15 ether, 15 ether, path, block.timestamp + 60);
        assertEq(vault.dailyCount(), 1);
        assertEq(vault.dailyVolume(), 15 ether);
        vm.stopPrank();
    }

    // ==========================================
    //           6. Fuzz Tests
    // ==========================================

    function testFuzz_ExecuteSwapWithinLimits(uint256 amount) public {
        // Restrict fuzzed amount to safe range: > 0 and <= maxPositionCap (10% of 1000 ether = 100 ether)
        vm.assume(amount > 0 && amount <= 100 ether);

        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(cake);

        // Restrict to volume cap (50 ether)
        if (amount > 50 ether) {
            vm.prank(agent);
            vm.expectRevert();
            vault.executeSwap(amount, 0, path, block.timestamp + 60);
        } else {
            vm.prank(agent);
            vault.executeSwap(amount, 0, path, block.timestamp + 60);
        }
    }

    // ==========================================
    //           7. Integration Test for Allowlist
    // ==========================================

    function test_AllowlistFromFileSucceeds() public {
        string memory jsonPath = "../config/token-allowlist-addresses.json";
        string memory json = vm.readFile(jsonPath);
        address[] memory addresses = abi.decode(vm.parseJson(json), (address[]));

        uint256 total = addresses.length;
        
        address[] memory batchStatuses = new address[](total);
        bool[] memory statuses = new bool[](total);
        for (uint256 j = 0; j < total; j++) {
            batchStatuses[j] = addresses[j];
            statuses[j] = true;
        }

        vm.prank(owner);
        vault.setAllowlist(batchStatuses, statuses);

        for (uint256 j = 0; j < total; j++) {
            assertTrue(vault.isAllowlisted(addresses[j]));
        }
    }
}

