

/**
 * Token Registry
 *
 * Maps symbol → on-chain BSC testnet ERC-20 address + Binance Futures perpetual pair.
 * Used by:
 *  - loop/index.ts  → passes the correct on-chain address to getRiskState()
 *  - data/index.ts  → uses the futures pair for real open-interest / funding-rate queries
 */

export interface TokenInfo {
  /** ERC-20 address on BSC Testnet */
  address: string;
  /** Binance Futures perpetual pair (null if no futures market exists) */
  futuresPair: string | null;
  /** CoinMarketCap symbol used in the quote API */
  cmcSymbol: string;
}

const TOKEN_REGISTRY: Record<string, TokenInfo> = {
  WBNB: {
    address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", // WBNB on BSC Testnet
    futuresPair: "BNBUSDT",
    cmcSymbol: "BNB",
  },
  CAKE: {
    address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // PancakeSwap CAKE (mainnet addr used for testnet allowlist)
    futuresPair: "CAKEUSDT",
    cmcSymbol: "CAKE",
  },
  ETH: {
    address: "0xd66c6b4f0be8ce5b39d52e0fd1344c389929b378", // ETH on BSC Testnet
    futuresPair: "ETHUSDT",
    cmcSymbol: "ETH",
  },
  BTC: {
    address: "0x6ce8da28e2f864420840cf74474eff5fd80e65b8", // BTCB on BSC Testnet
    futuresPair: "BTCUSDT",
    cmcSymbol: "BTC",
  },
  USDT: {
    address: "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd", // USDT on BSC Testnet
    futuresPair: null, // USDT is a stablecoin - no perpetual futures
    cmcSymbol: "USDT",
  },
  FLOKI: {
    address: "0xfb5B838b6cfEEdC2873aB27866079AC55363D37E",
    futuresPair: "FLOKIUSDT",
    cmcSymbol: "FLOKI",
  },
  TWT: {
    address: "0x4B0F1812e5Df2A09796481Ff14017e6005508003",
    futuresPair: "TWTUSDT",
    cmcSymbol: "TWT",
  },
  PENDLE: {
    address: "0xb3Ed0A426155B79B898849803E3B36552f7ED507",
    futuresPair: "PENDLEUSDT",
    cmcSymbol: "PENDLE",
  },
};

/**
 * Returns the TokenInfo for a given symbol.
 * Throws if the symbol is not in the registry.
 */
export function getTokenInfo(symbol: string): TokenInfo {
  const info = TOKEN_REGISTRY[symbol.toUpperCase()];
  if (!info) {
    throw new Error(
      `Token "${symbol}" is not in the registry. ` +
      `Available: ${Object.keys(TOKEN_REGISTRY).join(", ")}`
    );
  }
  return info;
}

/**
 * Returns on-chain address for a given symbol.
 */
export function getTokenAddress(symbol: string): string {
  return getTokenInfo(symbol).address;
}

/**
 * Returns the full registry (for iteration).
 */
export function getAllTokens(): Record<string, TokenInfo> {
  return TOKEN_REGISTRY;
}
