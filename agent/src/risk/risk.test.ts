import { RiskService, RiskState } from "./index.js";
import { TradeIntent } from "../decision/index.js";

describe("RiskService Rules validation", () => {
  const mockIntent: TradeIntent = {
    token: "CAKE",
    side: "BUY",
    sizePct: 10,
    entry: 2.5,
    takeProfit: 2.625,
    stopLoss: 2.425,
    timeStopCandles: 12,
  };

  const defaultState: RiskState = {
    isPaused: false,
    isTokenAllowlisted: true,
    vaultBalance: 10000000000000000000n, // 10 WBNB
    dailyVolume: 0n,
    dailyVolumeCap: 50000000000000000000n, // 50 WBNB
    dailyCount: 0,
    dailyCountCap: 10,
    maxPositionBps: 1000, // 10%
  };

  it("should approve intent under valid states", () => {
    const amountIn = 1000000000000000000n; // 1 WBNB (10% of balance)
    const result = RiskService.checkIntent(mockIntent, defaultState, amountIn, true);
    expect(result.approved).toBe(true);
  });

  it("should reject when vault is paused", () => {
    const state = { ...defaultState, isPaused: true };
    const amountIn = 1000000000000000000n;
    const result = RiskService.checkIntent(mockIntent, state, amountIn, true);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("paused");
  });

  it("should reject when token is not allowlisted", () => {
    const state = { ...defaultState, isTokenAllowlisted: false };
    const amountIn = 1000000000000000000n;
    const result = RiskService.checkIntent(mockIntent, state, amountIn, true);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("not allowlisted");
  });

  it("should reject when trade size exceeds position limit", () => {
    const amountIn = 2000000000000000000n; // 2 WBNB (20% of balance, cap is 10%)
    const result = RiskService.checkIntent(mockIntent, defaultState, amountIn, true);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("exceeds cap");
  });

  it("should reject when daily trade count cap is exceeded", () => {
    const state = { ...defaultState, dailyCount: 10 }; // cap is 10
    const amountIn = 1000000000000000000n;
    const result = RiskService.checkIntent(mockIntent, state, amountIn, true);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("daily count cap");
  });

  it("should reject when daily volume cap is exceeded", () => {
    const state = { ...defaultState, dailyVolume: 49500000000000000000n }; // 49.5 WBNB used
    const amountIn = 1000000000000000000n; // 1 WBNB would exceed 50 WBNB cap
    const result = RiskService.checkIntent(mockIntent, state, amountIn, true);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("daily volume cap");
  });
});
