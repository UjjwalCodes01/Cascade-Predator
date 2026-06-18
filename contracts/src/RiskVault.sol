// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IPancakeRouter02.sol";

/**
 * @title RiskVault
 * @notice Holds trading capital for the Cascade Predator agent and enforces strict on-chain risk limits.
 * @dev Owner wallet retains absolute withdrawal and parameter configuration control.
 *      Agent wallet is only allowed to perform swaps through an approved router within on-chain guardrails.
 */
contract RiskVault is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // --- Custom Errors ---
    error UnauthorizedAgent();
    error OffAllowlist(address token);
    error ExceedsPositionCap(uint256 amountIn, uint256 maxAmount);
    error ExceedsDailyVolumeCap(uint256 volumeAdded, uint256 currentVolume, uint256 maxVolume);
    error ExceedsDailyCountCap(uint256 currentCount, uint256 maxCount);
    error InvalidAllowlistParams();
    error WithdrawFailed();
    error InvalidAddress();
    error InvalidBps();
    error InvalidAmount();
    error InvalidPath();

    // --- State Variables ---

    /// @notice The address of the authorized trading agent daemon EOA.
    address public agent;

    /// @notice The base asset token address used for daily volume calculations (e.g., WBNB/USDT).
    address public immutable baseAsset;

    /// @notice The address of the PancakeSwap V2 Router.
    address public immutable pancakeRouter;

    /// @notice Mapping of allowlisted tokens that the vault is permitted to trade.
    mapping(address => bool) public isAllowlisted;

    /// @notice Maximum size of a single position in basis points of the current vault balance of the input token.
    /// @dev E.g., 1000 = 10% of vault's current balance of the input token.
    uint256 public maxPositionBps;

    /// @notice Maximum allowed cumulative volume of baseAsset swapped per 24 hours.
    uint256 public dailyVolumeCap;

    /// @notice Maximum allowed cumulative swap count per 24 hours.
    uint256 public dailyCountCap;

    /// @notice Cumulative volume of baseAsset swapped in the current 24-hour period.
    uint256 public dailyVolume;

    /// @notice Cumulative number of swaps in the current 24-hour period.
    uint256 public dailyCount;

    /// @notice Timestamp when the daily caps will reset.
    uint256 public dailyResetTimestamp;

    // --- Events ---
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

    // --- Modifiers ---
    modifier onlyAgent() {
        if (msg.sender != agent) revert UnauthorizedAgent();
        _;
    }

    /**
     * @notice Constructor to initialize the RiskVault contract.
     * @param _owner The initial owner address.
     * @param _agent The initial agent address.
     * @param _baseAsset The base asset token address (e.g., WBNB).
     * @param _pancakeRouter The PancakeSwap V2 Router address.
     */
    constructor(
        address _owner,
        address _agent,
        address _baseAsset,
        address _pancakeRouter
    ) Ownable(_owner) {
        if (_owner == address(0) || _agent == address(0) || _baseAsset == address(0) || _pancakeRouter == address(0)) {
            revert InvalidAddress();
        }
        agent = _agent;
        baseAsset = _baseAsset;
        pancakeRouter = _pancakeRouter;
        dailyResetTimestamp = block.timestamp + 1 days;

        // Default parameters (can be adjusted by owner later)
        maxPositionBps = 1000; // 10%
        dailyVolumeCap = 50 ether; // e.g., 50 WBNB
        dailyCountCap = 10; // e.g., max 10 swaps/day
    }

    // --- External/Public Functions ---

    /**
     * @notice Executes a swap on PancakeSwap V2 Router on behalf of the vault.
     * @dev Restricts calls only to the authorized agent EOA. Checks allowlist, position size, and daily limits on-chain.
     *      Pre-conditions:
     *        - Contract must not be paused.
     *        - Caller must be the authorized agent.
     *        - All tokens in path must be allowlisted.
     *        - amountIn must be <= maxPositionBps of current tokenIn balance.
     *        - Daily count and volume limits must not be exceeded.
     *      Post-conditions:
     *        - The vault's tokenIn balance is reduced by amountIn.
     *        - The vault's tokenOut balance is increased by >= amountOutMin.
     *        - Router allowance of tokenIn is reset to 0.
     *        - Daily count and volume are updated.
     * @param amountIn Amount of input token to swap.
     * @param amountOutMin Minimum amount of output token expected (slippage check).
     * @param path The token swap path from PancakeSwap (path[0] == tokenIn, path[path.length - 1] == tokenOut).
     * @param deadline Unix timestamp deadline for the transaction.
     */
    function executeSwap(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external onlyAgent whenNotPaused nonReentrant {
        if (path.length < 2) revert InvalidPath();
        if (amountIn == 0) revert InvalidAmount();

        // 1. Validate allowlist for every token in the path
        for (uint256 i = 0; i < path.length; i++) {
            if (!isAllowlisted[path[i]]) revert OffAllowlist(path[i]);
        }

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        // 2. Enforce single-position sizing limit (maxPositionBps)
        uint256 tokenInBalance = IERC20(tokenIn).balanceOf(address(this));
        uint256 maxAmount = (tokenInBalance * maxPositionBps) / 10000;
        if (amountIn > maxAmount) revert ExceedsPositionCap(amountIn, maxAmount);

        // 3. Update and enforce daily limits
        if (block.timestamp >= dailyResetTimestamp) {
            dailyVolume = 0;
            dailyCount = 0;
            dailyResetTimestamp = block.timestamp + 1 days;
        }

        if (dailyCount + 1 > dailyCountCap) {
            revert ExceedsDailyCountCap(dailyCount + 1, dailyCountCap);
        }

        if (tokenIn == baseAsset) {
            if (dailyVolume + amountIn > dailyVolumeCap) {
                revert ExceedsDailyVolumeCap(amountIn, dailyVolume, dailyVolumeCap);
            }
            dailyVolume += amountIn;
        }
        dailyCount += 1;

        // 4. Perform the swap
        IERC20(tokenIn).approve(pancakeRouter, amountIn);

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));

        // Note: Router handles deadline and amountOutMin internally. We rely on it for execution.
        IPancakeRouter02(pancakeRouter).swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            address(this),
            deadline
        );

        uint256 balanceAfter = IERC20(tokenOut).balanceOf(address(this));
        uint256 amountOut = balanceAfter - balanceBefore;

        // 5. Clean up allowance (defense-in-depth)
        IERC20(tokenIn).approve(pancakeRouter, 0);

        emit SwapExecuted(tokenIn, tokenOut, amountIn, amountOut);
    }

    /**
     * @notice Withdraws native BNB or ERC20 tokens from the vault.
     * @dev Restricts call to the owner only. Can be executed when paused.
     *      Pre-conditions:
     *        - Caller must be the contract owner.
     *        - Vault must hold >= amount of the requested token (or native BNB).
     *      Post-conditions:
     *        - Vault's balance of token is decreased by amount.
     *        - Owner's balance of token is increased by amount.
     * @param token Address of the token to withdraw (address(0) for native BNB).
     * @param amount The quantity to withdraw.
     */
    function withdraw(address token, uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        if (token == address(0)) {
            (bool success, ) = msg.sender.call{value: amount}("");
            if (!success) revert WithdrawFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
        emit FundsWithdrawn(token, msg.sender, amount);
    }

    /**
     * @notice Updates the risk parameter configurations on-chain.
     * @dev Restricts call to the owner only.
     *      Pre-conditions:
     *        - Caller must be the owner.
     *        - _maxPositionBps must be <= 10000 (100%).
     *      Post-conditions:
     *        - maxPositionBps, dailyVolumeCap, and dailyCountCap are updated.
     * @param _maxPositionBps The max size of a single trade (in basis points).
     * @param _dailyVolumeCap The daily volume threshold of baseAsset.
     * @param _dailyCountCap The daily count threshold of trades.
     */
    function setRiskParams(
        uint256 _maxPositionBps,
        uint256 _dailyVolumeCap,
        uint256 _dailyCountCap
    ) external onlyOwner {
        if (_maxPositionBps > 10000) revert InvalidBps();
        maxPositionBps = _maxPositionBps;
        dailyVolumeCap = _dailyVolumeCap;
        dailyCountCap = _dailyCountCap;
        emit RiskParamsUpdated(_maxPositionBps, _dailyVolumeCap, _dailyCountCap);
    }

    /**
     * @notice Sets the allowlist status for an array of tokens.
     * @dev Restricts call to the owner only. Allows batch additions and removals.
     *      Pre-conditions:
     *        - Caller must be the owner.
     *        - tokens and statuses arrays must have equal lengths.
     *        - Token addresses must not be address(0).
     *      Post-conditions:
     *        - isAllowlisted status of each token is updated.
     * @param tokens Array of token addresses to configure.
     * @param statuses Array of boolean flags designating allowlist status.
     */
    function setAllowlist(address[] calldata tokens, bool[] calldata statuses) external onlyOwner {
        if (tokens.length != statuses.length) revert InvalidAllowlistParams();
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0)) revert InvalidAddress();
            isAllowlisted[tokens[i]] = statuses[i];
            emit AllowlistUpdated(tokens[i], statuses[i]);
        }
    }

    /**
     * @notice Re-assigns the authorized agent daemon address.
     * @dev Restricts call to the owner only.
     *      Pre-conditions:
     *        - Caller must be the owner.
     *        - _agent must not be address(0).
     *      Post-conditions:
     *        - agent address is updated.
     * @param _agent The new agent EOA address.
     */
    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert InvalidAddress();
        address oldAgent = agent;
        agent = _agent;
        emit AgentUpdated(oldAgent, _agent);
    }

    /**
     * @notice Pauses the execution of swaps in case of emergency.
     * @dev Restricts call to the owner only. Does not block owner withdrawals.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the execution of swaps once safety is restored.
     * @dev Restricts call to the owner only.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Fallback to accept native BNB deposits.
     */
    receive() external payable {}
}
