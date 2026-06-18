import { TradeIntent } from "../decision/index.js";

export interface RiskState {
  isPaused: boolean;
  isTokenAllowlisted: boolean;
  vaultBalance: bigint;       // current vault balance of input token
  dailyVolume: bigint;        // current 24h accumulated volume of baseAsset
  dailyVolumeCap: bigint;     // max 24h volume cap of baseAsset
  dailyCount: number;         // current 24h accumulated trade count
  dailyCountCap: number;      // max 24h trade count cap
  maxPositionBps: number;     // max single position size in basis points (e.g. 1000 = 10%)
}

export interface RiskVerdict {
  approved: boolean;
  reason?: string;
}

export class RiskService {
  /**
   * Evaluates a trade intent against on-chain and off-chain safety boundaries.
   * This is a PURE function. No clock, no side effects, no state access.
   */
  static checkIntent(
    intent: TradeIntent,
    state: RiskState,
    amountIn: bigint,
    isBaseAsset: boolean
  ): RiskVerdict {
    // 1. Check if vault is paused
    if (state.isPaused) {
      return { approved: false, reason: "Vault is paused" };
    }

    // 2. Check token allowlist
    if (!state.isTokenAllowlisted) {
      return { approved: false, reason: `Token is not allowlisted: ${intent.token}` };
    }

    // 3. Check position size limit (maxPositionBps)
    const maxAmount = (state.vaultBalance * BigInt(state.maxPositionBps)) / 10000n;
    if (amountIn > maxAmount) {
      return {
        approved: false,
        reason: `Position size ${amountIn.toString()} exceeds cap of ${maxAmount.toString()} (maxPositionBps: ${state.maxPositionBps})`,
      };
    }

    // 4. Check daily trade count limit
    if (state.dailyCount + 1 > state.dailyCountCap) {
      return {
        approved: false,
        reason: `Exceeds daily count cap: ${state.dailyCount + 1} / ${state.dailyCountCap}`,
      };
    }

    // 5. Check daily volume cap (only applies if input token is baseAsset)
    if (isBaseAsset) {
      if (state.dailyVolume + amountIn > state.dailyVolumeCap) {
        return {
          approved: false,
          reason: `Exceeds daily volume cap: ${(state.dailyVolume + amountIn).toString()} / ${state.dailyVolumeCap.toString()}`,
        };
      }
    }

    // All checks passed!
    return { approved: true };
  }
}
