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
  mcpReport?: any;          // Optional CMC MCP Regime Report
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
  const cmcUrl = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${cmcSymbol}`;
  const cost = "0.01";

  const rawData = await X402Service.executeWithPayment<any>(
    async (paymentHeader) => {
      // If paymentHeader is missing, simulate a 402 status so the wrapper retries with a payment proof
      if (!paymentHeader) {
        return { status: 402 };
      }

      const headers: Record<string, string> = {
        "X-CMC_PRO_API_KEY": config.CMC_API_KEY,
        "Accept": "application/json",
        "Authorization": paymentHeader,
      };
      const r = await fetch(cmcUrl, { headers });
      return { status: r.status, data: r.status === 200 ? await r.json() : undefined };
    },
    `cmc/quotes/${cmcSymbol}`,
    cost
  );

  const raw = rawData.data[cmcSymbol];
  const entry = Array.isArray(raw) ? raw[0] : raw;
  const q = entry?.quote?.USD;
  if (!q) throw new Error(`CMC returned no data for ${cmcSymbol}`);

  return {
    price: q.price,
    volume24h: q.volume_24h,
    marketCap: q.market_cap,
    pctChange1h: q.percent_change_1h,
    pctChange24h: q.percent_change_24h,
  };
}

interface McpRegimeReport {
  fear_greed_value: number;
  market_regime: string;
  conviction: string;
  leverage_state: string;
  liquidation_state: string;
  summary: string;
  action_guidance?: any;
  raw_report?: any;
}

async function fetchMarketRegimeFromMcp(): Promise<McpRegimeReport> {
  if (!config.CMC_API_KEY) {
    throw new Error("CMC_API_KEY is not set in environment.");
  }

  const url = "https://mcp.coinmarketcap.com/skill-hub/stream";
  const headers = {
    "X-CMC-MCP-API-KEY": config.CMC_API_KEY,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  const payload = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: "execute_skill",
      arguments: {
        unique_name: "detect_market_regime",
        parameters: {
          time_window: "30d",
        },
      },
    },
    id: 100,
  };

  console.log("[mcp] Calling CMC Agent Hub detect_market_regime skill...");
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`MCP API returned status ${res.status}`);
  }

  const text = await res.text();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const dataJson = line.substring(5).trim();
      const rpcResponse = JSON.parse(dataJson);

      if (rpcResponse.error) {
        throw new Error(`MCP RPC Error: ${JSON.stringify(rpcResponse.error)}`);
      }

      const resultContent = rpcResponse.result?.content;
      if (!resultContent || resultContent.length === 0) {
        throw new Error("MCP response content is empty");
      }

      const rawText = resultContent[0].text;
      if (!rawText) {
        throw new Error("MCP content text is empty");
      }

      const outerResult = JSON.parse(rawText);
      const rpcInnerRes = outerResult.result;
      if (rpcInnerRes?.error) {
        throw new Error(`MCP inner execution failed: ${JSON.stringify(rpcInnerRes.error)}`);
      }

      const outputStr = rpcInnerRes?.output;
      if (!outputStr) {
        throw new Error("MCP output is empty");
      }

      const skillResult = JSON.parse(outputStr);
      const evidenceData = skillResult.result?.data;

      const status = evidenceData?.status;
      if (status !== "ok") {
        throw new Error(`MCP skill returned non-ok status: ${status}`);
      }

      const report = evidenceData.report;
      const metrics = report?.metrics;

      return {
        fear_greed_value: parseInt(metrics?.fear_greed_value ?? "50", 10),
        market_regime: report?.market_regime ?? "unknown",
        conviction: report?.conviction ?? "unknown",
        leverage_state: report?.leverage_state ?? "unknown",
        liquidation_state: report?.liquidation_state ?? "unknown",
        summary: evidenceData?.summary ?? "",
        action_guidance: evidenceData?.action_guidance,
        raw_report: report,
      };
    }
  }

  throw new Error("No event:message data found in MCP stream response");
}

async function fetchFearGreedFallback(): Promise<number> {
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
   * - Fear & Greed / Regime info     → CMC MCP (fallback: REST API)
   * - Funding rate, open interest   → Binance Futures REST API (no key required)
   * - Liquidation proxy             → Binance taker buy/sell ratio
   */
  static async fetchSnapshot(token: string): Promise<MarketSnapshot> {
    try {
      const tokenInfo = getTokenInfo(token);

      // 1. Fetch real spot price from CMC
      const spot = await fetchCmcSpotData(tokenInfo.cmcSymbol);

      // 2. Fetch Fear & Greed and regime info from CMC MCP (with REST fallback)
      let fearGreed = 50;
      let mcpReport: McpRegimeReport | undefined;

      try {
        mcpReport = await fetchMarketRegimeFromMcp();
        fearGreed = mcpReport.fear_greed_value;
        console.log(`[mcp] Successfully fetched Fear & Greed (${fearGreed}) and Regime (${mcpReport.market_regime}) from CMC Agent Hub.`);
      } catch (mcpError: any) {
        console.warn(`[mcp] CMC Agent Hub call failed: ${mcpError.message}. Falling back to REST API.`);
        fearGreed = await fetchFearGreedFallback();
      }

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

      return {
        token,
        fundingRate: derivs.fundingRate,
        openInterest: derivs.openInterest,
        liquidations: derivs.liquidations,
        price: spot.price,
        fearGreed,
        timestamp: Date.now(),
        longShortRatio: derivs.longShortRatio,
        takerBuySellRatio: derivs.takerBuySellRatio,
        mcpReport,
      };
    } catch (error) {
      console.error(`[data] Failed to fetch live data for ${token}:`, (error as Error).message);
      throw error; // Propagate — do not silently hide failures
    }
  }
}
