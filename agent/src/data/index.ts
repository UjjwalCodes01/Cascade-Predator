import { config } from "../config/index.js";
import { X402Service } from "../x402/index.js";
import { getTokenInfo } from "../tokens/index.js";

export interface MarketSnapshot {
  token: string;
  fundingRate: number;      // in decimal (e.g. 0.0001 = 0.01% funding rate)
  openInterest: number;     // open interest in USD
  liquidations: number;     // estimated 1h liquidation volume in USD (derived from taker long/short ratio)
  price: number;            // spot price in USD
  fearGreed: number;        // CMC fear & greed index (0-100)
  timestamp: number;        // timestamp in ms
  // Extra context fields for richer cascade scoring
  longShortRatio: number;   // ratio of long / short accounts (>1 = more longs)
  takerBuySellRatio: number; // ratio of taker buy / sell volume (>1 = buyers dominate)
}

// ─── Binance Futures helpers ─────────────────────────────────────────────────

const BINANCE_FAPI = "https://fapi.binance.com";

interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

interface BinanceOpenInterest {
  symbol: string;
  openInterest: string; // number of contracts (in base asset units)
}

interface BinanceLongShortRatio {
  symbol: string;
  longShortRatio: string;
  longAccount: string;
  shortAccount: string;
  timestamp: number;
}

interface BinanceTakerRatio {
  buySellRatio: string;
  buyVol: string;
  sellVol: string;
  timestamp: number;
}

async function fetchFuturesData(futuresPair: string, spotPrice: number): Promise<{
  fundingRate: number;
  openInterest: number;
  liquidations: number;
  longShortRatio: number;
  takerBuySellRatio: number;
}> {
  try {
    const [premiumRes, oiRes, lsRatioRes, takerRes] = await Promise.all([
      fetch(`${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${futuresPair}`),
      fetch(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${futuresPair}`),
      fetch(`${BINANCE_FAPI}/futures/data/globalLongShortAccountRatio?symbol=${futuresPair}&period=5m&limit=1`),
      fetch(`${BINANCE_FAPI}/futures/data/takerlongshortRatio?symbol=${futuresPair}&period=5m&limit=3`),
    ]);

    if (!premiumRes.ok || !oiRes.ok || !lsRatioRes.ok || !takerRes.ok) {
      throw new Error(`Binance API returned non-OK status`);
    }

    const premium = (await premiumRes.json()) as BinancePremiumIndex;
    const oi = (await oiRes.json()) as BinanceOpenInterest;
    const [lsRatio] = (await lsRatioRes.json()) as BinanceLongShortRatio[];
    const takerRatios = (await takerRes.json()) as BinanceTakerRatio[];

    // Funding rate (already in decimal form, e.g. 0.0001)
    const fundingRate = parseFloat(premium.lastFundingRate);

    // Open interest: contracts × spot price = USD value
    const openInterest = parseFloat(oi.openInterest) * spotPrice;

    // Long/short ratio
    const longShortRatio = parseFloat(lsRatio.longShortRatio);

    // Taker buy/sell ratio (average of last 3 periods = 15 min window)
    const avgTakerRatio = takerRatios.reduce((sum, r) => sum + parseFloat(r.buySellRatio), 0) / takerRatios.length;
    const takerBuySellRatio = avgTakerRatio;

    // Derive liquidation proxy:
    // When taker sell volume vastly exceeds buy volume, it indicates forced liquidations.
    // We use the most recent 5m window sell volume × price as the proxy.
    const latestTaker = takerRatios[takerRatios.length - 1];
    const rawSellVol = parseFloat(latestTaker.sellVol); // base asset units
    const rawBuyVol = parseFloat(latestTaker.buyVol);
    // If sells dominate by > 20%, estimate liquidations as the excess sell volume
    const sellExcess = Math.max(0, rawSellVol - rawBuyVol);
    const liquidations = sellExcess * spotPrice; // in USD

    return { fundingRate, openInterest, liquidations, longShortRatio, takerBuySellRatio };
  } catch (err) {
    console.warn(`[data] Binance futures API failed for ${futuresPair}:`, (err as Error).message);
    // Return neutral defaults rather than crashing the daemon
    return {
      fundingRate: 0.0001,
      openInterest: 0,
      liquidations: 0,
      longShortRatio: 1,
      takerBuySellRatio: 1,
    };
  }
}

// ─── CMC helpers ─────────────────────────────────────────────────────────────

async function fetchCmcSpotData(cmcSymbol: string): Promise<{
  price: number;
  volume24h: number;
  marketCap: number;
  pctChange1h: number;
  pctChange24h: number;
}> {
  const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${cmcSymbol}`;
  const res = await fetch(url, {
    headers: {
      "X-CMC_PRO_API_KEY": config.CMC_API_KEY,
      "Accept": "application/json",
    },
  });

  if (!res.ok) throw new Error(`CMC Quotes API returned status ${res.status}`);

  const json = (await res.json()) as any;
  const q = json.data[cmcSymbol]?.quote?.USD;
  if (!q) throw new Error(`CMC returned no data for ${cmcSymbol}`);

  return {
    price: q.price,
    volume24h: q.volume_24h,
    marketCap: q.market_cap,
    pctChange1h: q.percent_change_1h,
    pctChange24h: q.percent_change_24h,
  };
}

async function fetchFearGreed(): Promise<number> {
  try {
    const res = await fetch("https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest", {
      headers: {
        "X-CMC_PRO_API_KEY": config.CMC_API_KEY,
        "Accept": "application/json",
      },
    });
    if (!res.ok) return 50;
    const json = (await res.json()) as any;
    return json.data.value ?? 50;
  } catch {
    return 50; // neutral fallback
  }
}

// ─── DataService ──────────────────────────────────────────────────────────────

export class DataService {
  /**
   * Fetches a fully real, live MarketSnapshot for a given token symbol.
   * - Spot price, volume, market cap → CMC REST API
   * - Fear & Greed index            → CMC REST API
   * - Funding rate, open interest   → Binance Futures REST API (no key required)
   * - Liquidation proxy             → Binance taker buy/sell ratio
   *
   * Wrapped in the x402 payment flow to demonstrate HTTP-402 micro-payments.
   */
  static async fetchSnapshot(token: string): Promise<MarketSnapshot> {
    const cost = "0.0001";
    const resource = `cmc/derivatives/${token}`;

    return X402Service.executeWithPayment<MarketSnapshot>(
      async (paymentHeader) => {
        if (!paymentHeader) {
          return { status: 402 };
        }

        try {
          const tokenInfo = getTokenInfo(token);

          // 1. Fetch real spot price from CMC
          const spot = await fetchCmcSpotData(tokenInfo.cmcSymbol);

          // 2. Fetch real Fear & Greed index from CMC
          const fearGreed = await fetchFearGreed();

          // 3. Fetch real derivatives data from Binance Futures (if a futures pair exists)
          let derivs = {
            fundingRate: 0.0001 as number,
            openInterest: 0 as number,
            liquidations: 0 as number,
            longShortRatio: 1 as number,
            takerBuySellRatio: 1 as number,
          };
          if (tokenInfo.futuresPair) {
            derivs = await fetchFuturesData(tokenInfo.futuresPair, spot.price);
          }

          const snapshot: MarketSnapshot = {
            token,
            fundingRate: derivs.fundingRate,
            openInterest: derivs.openInterest,
            liquidations: derivs.liquidations,
            price: spot.price,
            fearGreed,
            timestamp: Date.now(),
            longShortRatio: derivs.longShortRatio,
            takerBuySellRatio: derivs.takerBuySellRatio,
          };

          return { status: 200, data: snapshot };
        } catch (error) {
          console.error(`[data] Failed to fetch live data for ${token}:`, (error as Error).message);
          throw error; // Propagate — do not silently hide failures
        }
      },
      resource,
      cost
    );
  }
}
