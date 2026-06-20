/**
 * Applies a 0.25% fee per leg (0.50% round-trip) to trade values.
 */
export class FeeService {
  static FEE_PER_LEG_PCT = 0.25;

  /**
   * Applies the fee to a position entry or exit value.
   * Entry: costs +0.25% fee.
   * Exit: returns -0.25% fee.
   */
  static applyFee(value: number): number {
    return value * (1 - this.FEE_PER_LEG_PCT / 100);
  }

  /**
   * Calculates net return of a trade given entry and exit prices.
   * Includes 0.25% fee on entry and 0.25% fee on exit.
   */
  static calculateNetReturn(entryPrice: number, exitPrice: number): number {
    const grossReturn = (exitPrice - entryPrice) / entryPrice;
    // (1 - fee) * (1 + gross) * (1 - fee) - 1
    const entryFeeFactor = 1 - this.FEE_PER_LEG_PCT / 100;
    const exitFeeFactor = 1 - this.FEE_PER_LEG_PCT / 100;
    return entryFeeFactor * (exitPrice / entryPrice) * exitFeeFactor - 1;
  }
}
