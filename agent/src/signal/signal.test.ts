import { SignalService } from "./index.js";
import { MarketSnapshot } from "../data/index.js";

describe("SignalService Cascade Scoring", () => {
  const mockToken = "WBNB";

  it("should return a low score under calm market conditions", () => {
    const current: MarketSnapshot = {
      token: mockToken,
      fundingRate: 0.0001,
      openInterest: 10000000,
      liquidations: 1000, // Very low liquidations
      price: 100,
      fearGreed: 50,
      timestamp: Date.now(),
      longShortRatio: 1,
      takerBuySellRatio: 1,
    };

    const history: MarketSnapshot[] = [
      { ...current, price: 100, timestamp: Date.now() - 60000 },
      { ...current, price: 100, timestamp: Date.now() - 30000 },
    ];

    const result = SignalService.computeScore(current, history);
    expect(result.cascadeScore).toBeLessThan(30);
    expect(result.components.liquidationIntensity).toBeLessThan(1);
    expect(result.components.priceDeviation).toBe(0);
  });

  it("should return a high score when liquidations spike and price dumps (overshoot)", () => {
    const current: MarketSnapshot = {
      token: mockToken,
      fundingRate: -0.0005, // Negative funding (extreme short pressure)
      openInterest: 10000000,
      liquidations: 60000, // Spike in liquidations (0.6% of OI)
      price: 93, // ~7% dump from history average
      fearGreed: 30,
      timestamp: Date.now(),
      longShortRatio: 1,
      takerBuySellRatio: 1,
    };

    const history: MarketSnapshot[] = [
      { token: mockToken, fundingRate: 0.0001, openInterest: 10000000, liquidations: 1000, price: 100, fearGreed: 50, timestamp: Date.now() - 60000, longShortRatio: 1, takerBuySellRatio: 1 },
      { token: mockToken, fundingRate: 0.0001, openInterest: 10000000, liquidations: 1000, price: 100, fearGreed: 50, timestamp: Date.now() - 30000, longShortRatio: 1, takerBuySellRatio: 1 },
    ];

    const result = SignalService.computeScore(current, history);
    expect(result.cascadeScore).toBeGreaterThanOrEqual(70);
    expect(result.components.liquidationIntensity).toBe(40); // Maxed out at 40
    expect(result.components.priceDeviation).toBeGreaterThan(30); // High price drop score
    expect(result.components.fundingStress).toBe(20); // Maxed out negative funding
  });
});
