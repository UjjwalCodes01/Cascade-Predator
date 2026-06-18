import { MarketSnapshot } from "../data/index.js";

export interface SignalComponents {
  liquidationIntensity: number; // 0 to 40
  priceDeviation: number;       // 0 to 40
  fundingStress: number;        // 0 to 20
}

export interface CascadeSignal {
  token: string;
  cascadeScore: number;         // 0 to 100
  components: SignalComponents;
  timestamp: number;
}

export class SignalService {
  /**
   * Computes the Cascade Probability Score (0 - 100) based on market indicators.
   * This is a PURE function: no side-effects, no network, no clock calls.
   * 
   * @param current The current market snapshot.
   * @param history A chronological list of past snapshots (oldest to newest).
   */
  static computeScore(current: MarketSnapshot, history: MarketSnapshot[]): CascadeSignal {
    const token = current.token;
    const timestamp = current.timestamp;

    // Default components to 0
    let liquidationIntensity = 0;
    let priceDeviation = 0;
    let fundingStress = 0;

    // 1. Calculate Liquidation Intensity (Cap: 40 points)
    // We measure liquidations relative to the overall Open Interest.
    if (current.openInterest > 0) {
      const liqRatio = current.liquidations / current.openInterest;
      // E.g., ratio of 0.005 (0.5% of open interest liquidated) represents high stress.
      liquidationIntensity = Math.min((liqRatio / 0.005) * 40, 40);
    }

    // 2. Calculate Price Deviation / Overshoot (Cap: 40 points)
    // We measure how far the price has deviated from the recent history average (overshoot).
    if (history.length > 0) {
      const avgPrice = history.reduce((sum, h) => sum + h.price, 0) / history.length;
      const deviation = (current.price - avgPrice) / avgPrice;

      // We only hunt long liquidation overshoots (buying the dump/rebound),
      // so we score negative deviations (price drops).
      if (deviation < 0) {
        // E.g., a 5% drop from average price scores max deviation points.
        const absDev = Math.abs(deviation);
        priceDeviation = Math.min((absDev / 0.05) * 40, 40);
      }
    }

    // 3. Calculate Funding Stress (Cap: 20 points)
    // A sudden drop in funding rate indicates heavy shorting/cap capitulation.
    if (current.fundingRate < 0) {
      // Negative funding = extreme short pressure (ideal for buying snap-back).
      fundingStress = 20;
    } else if (current.fundingRate < 0.0002) {
      // Low funding = moderate stress.
      fundingStress = Math.max((0.0002 - current.fundingRate) / 0.0002 * 20, 0);
    }

    // Combine score components (Max: 100)
    const rawScore = liquidationIntensity + priceDeviation + fundingStress;
    const cascadeScore = parseFloat(Math.min(rawScore, 100).toFixed(2));

    return {
      token,
      cascadeScore,
      components: {
        liquidationIntensity: parseFloat(liquidationIntensity.toFixed(2)),
        priceDeviation: parseFloat(priceDeviation.toFixed(2)),
        fundingStress: parseFloat(fundingStress.toFixed(2)),
      },
      timestamp,
    };
  }
}
