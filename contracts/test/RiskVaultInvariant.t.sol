// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import "../src/RiskVault.sol";
import "./RiskVault.t.sol";

contract RiskVaultHandler is Test {
    RiskVault public vault;
    MockRouter public router;
    MockERC20 public wbnb;
    MockERC20 public cake;
    MockERC20 public unsafeToken;

    address public owner;
    address public agent;
    address public stranger;

    uint256 public ghost_succeededSwaps;
    uint256 public ghost_failedSwaps;

    constructor(
        RiskVault _vault,
        MockRouter _router,
        MockERC20 _wbnb,
        MockERC20 _cake,
        MockERC20 _unsafeToken,
        address _owner,
        address _agent,
        address _stranger
    ) {
        vault = _vault;
        router = _router;
        wbnb = _wbnb;
        cake = _cake;
        unsafeToken = _unsafeToken;
        owner = _owner;
        agent = _agent;
        stranger = _stranger;
    }

    function executeSwap(
        uint256 amountIn,
        uint256 amountOutMin,
        bool useUnsafeToken,
        bool useStranger
    ) public {
        // Bound amountIn to a sensible range to avoid overflow or division by zero issues
        amountIn = bound(amountIn, 1, 10 ether);

        address tokenIn = address(wbnb);
        address tokenOut = useUnsafeToken ? address(unsafeToken) : address(cake);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        address caller = useStranger ? stranger : agent;

        // Ensure vault has enough wbnb for the swap
        wbnb.mint(address(vault), amountIn);

        vm.prank(caller);
        try vault.executeSwap(amountIn, amountOutMin, path, block.timestamp + 60) {
            ghost_succeededSwaps++;
            // Verify that we didn't exceed limits
            require(!useUnsafeToken, "Swapped off-allowlist token!");
            require(caller == agent, "Stranger executed swap!");
            require(!vault.paused(), "Swap executed while paused!");
        } catch {
            ghost_failedSwaps++;
        }
    }

    function withdraw(
        address token,
        uint256 amount,
        bool isOwner
    ) public {
        amount = bound(amount, 1, 100 ether);
        address caller = isOwner ? owner : stranger;
        address targetToken = token == address(0) ? address(0) : address(wbnb);

        if (targetToken != address(0)) {
            wbnb.mint(address(vault), amount);
        } else {
            vm.deal(address(vault), amount);
        }

        vm.prank(caller);
        try vault.withdraw(targetToken, amount) {
            require(caller == owner, "Non-owner withdrew funds!");
        } catch {
            require(caller != owner, "Owner withdrawal failed");
        }
    }

    function togglePause(bool isOwner) public {
        address caller = isOwner ? owner : stranger;
        vm.prank(caller);
        try vault.pause() {} catch {
            try vault.unpause() {} catch {}
        }
    }
}

contract RiskVaultInvariantTest is Test {
    RiskVault public vault;
    MockRouter public router;
    MockERC20 public wbnb;
    MockERC20 public cake;
    MockERC20 public unsafeToken;

    address public owner = address(0xAA);
    address public agent = address(0xBB);
    address public stranger = address(0xCC);

    RiskVaultHandler public handler;

    function setUp() public {
        wbnb = new MockERC20("Wrapped BNB", "WBNB");
        cake = new MockERC20("PancakeSwap Token", "CAKE");
        unsafeToken = new MockERC20("Unsafe Token", "UNSAFE");

        router = new MockRouter();
        vault = new RiskVault(owner, agent, address(wbnb), address(router));

        // Allowlist WBNB and CAKE, but NOT unsafeToken
        address[] memory tokens = new address[](2);
        tokens[0] = address(wbnb);
        tokens[1] = address(cake);
        bool[] memory statuses = new bool[](2);
        statuses[0] = true;
        statuses[1] = true;

        vm.prank(owner);
        vault.setAllowlist(tokens, statuses);

        // Fund router with CAKE for swaps
        cake.mint(address(router), 1000000 ether);

        handler = new RiskVaultHandler(
            vault,
            router,
            wbnb,
            cake,
            unsafeToken,
            owner,
            agent,
            stranger
        );

        targetContract(address(handler));
    }

    // Invariant 1: Agent can never withdraw to an external address
    function invariant_AgentCannotWithdraw() public {
        assertEq(wbnb.balanceOf(agent), 0);
        assertEq(cake.balanceOf(agent), 0);
        assertEq(unsafeToken.balanceOf(agent), 0);
    }

    // Invariant 2: Daily count never exceeds dailyCountCap
    function invariant_DailyCountLimit() public {
        assertTrue(vault.dailyCount() <= vault.dailyCountCap());
    }

    // Invariant 3: Daily volume never exceeds dailyVolumeCap
    function invariant_DailyVolumeLimit() public {
        assertTrue(vault.dailyVolume() <= vault.dailyVolumeCap());
    }
}
