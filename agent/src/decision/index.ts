import { GoogleGenAI } from "@google/genai";
import { CascadeSignal } from "../signal/index.js";
import { MarketSnapshot } from "../data/index.js";
import { X402Service } from "../x402/index.js";
import { config } from "../config/index.js";

export interface TradeIntent {
  token: string;
  side: "BUY" | "SELL";
  sizePct: number;          // Percent of available vault balance to use
  entry: number;            // Current spot price
  takeProfit: number;       // Take-profit target price
  stopLoss: number;         // Stop-loss limit price
  timeStopCandles: number;  // Timeout in loop ticks if neither TP nor SL hit
}

/** LLM decision output — strict JSON schema enforced */
interface LlmDecision {
  approved: boolean;
  confidence: number;     // 0–100
  reasoning: string;      // One-sentence justification
}

// ── System prompt (injected once per session) ─────────────────────────────
const SYSTEM_PROMPT = `You are a quantitative trading AI specializing in short-term liquidation cascade events on the BNB Smart Chain DEX markets.

Your sole task is to evaluate whether the provided technical indicators justify opening a BUY position to capture a liquidation cascade snap-back.

A liquidation cascade occurs when large leveraged positions get forcefully closed, causing a rapid price drop followed by a sharp recovery as buying pressure absorbs the forced selling.

## Strategy Logic
- HIGH liquidationIntensity (>25): Confirms heavy forced selling is occurring.
- HIGH priceDeviation (>20): Confirms price has overshot below mean — recovery expected.
- NEGATIVE fundingRate: Confirms excessive short positioning — squeeze imminent.
- cascadeScore >= 70: Strong composite signal.

## Your output MUST be a single valid JSON object with exactly these fields:
{
  "approved": boolean,
  "confidence": number (0-100),
  "reasoning": "one concise sentence"
}

## Rules
- Approve ONLY if you are confident this is a genuine short-term cascade snap-back opportunity.
- Do NOT approve if cascadeScore < 40 (pre-filter should prevent this but enforce it).
- Do NOT approve if liquidationIntensity < 10 and priceDeviation < 10 (weak signal).
- Confidence above 75 is required to approve.
- Output ONLY the JSON object. No markdown. No explanation outside the JSON.`;

// ── Lazy-initialised Gemini client ────────────────────────────────────────
let _geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  const useVertex = config.USE_VERTEX_AI === "true" || !!config.GOOGLE_CLOUD_PROJECT || !config.GEMINI_API_KEY || config.GEMINI_API_KEY === "your_gemini_api_key_here";

  if (!_geminiClient) {
    if (useVertex) {
      console.log(`[decision] Initializing GoogleGenAI client for Vertex AI (Project: ${config.GOOGLE_CLOUD_PROJECT}, Location: ${config.GOOGLE_CLOUD_LOCATION})`);
      _geminiClient = new GoogleGenAI({
        vertexai: true,
        project: config.GOOGLE_CLOUD_PROJECT,
        location: config.GOOGLE_CLOUD_LOCATION,
      });
    } else {
      console.log(`[decision] Initializing GoogleGenAI client with API key`);
      _geminiClient = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    }
  }
  return _geminiClient;
}

// ── LLM call with structured JSON output ─────────────────────────────────
async function consultGemini(
  signal: CascadeSignal,
  snapshot: MarketSnapshot
): Promise<LlmDecision | null> {
  const client = getGeminiClient();
  if (!client) return null;

  let userMessage = `
## Market Signal for ${signal.token}

**Cascade Score:** ${signal.cascadeScore}/100 (threshold: ${config.CASCADE_SCORE_THRESHOLD})

### Signal Components
- Liquidation Intensity: ${signal.components.liquidationIntensity}/40
- Price Deviation from Mean: ${signal.components.priceDeviation}/40
- Funding Rate Stress: ${signal.components.fundingStress}/20

### Live Market Data
- Current Price: $${snapshot.price.toFixed(4)}
- Open Interest: $${(snapshot.openInterest / 1_000_000).toFixed(2)}M
- Estimated Liquidations: $${(snapshot.liquidations / 1_000).toFixed(1)}K
- Funding Rate: ${(snapshot.fundingRate * 100).toFixed(4)}%
- Long/Short Ratio: ${snapshot.longShortRatio?.toFixed(2) ?? "N/A"}
`;

  if (snapshot.mcpReport) {
    userMessage += `
### CoinMarketCap Agent Hub Market Regime Insights
- Market Regime: ${snapshot.mcpReport.market_regime}
- Conviction: ${snapshot.mcpReport.conviction}
- Leverage State: ${snapshot.mcpReport.leverage_state}
- Liquidation State: ${snapshot.mcpReport.liquidation_state}
- Summary: ${snapshot.mcpReport.summary}
- Action Guidance: ${snapshot.mcpReport.action_guidance?.next_step ?? "N/A"}
`;
  }

  userMessage += `
### Risk Parameters (from vault config)
- Take Profit: +${config.TAKE_PROFIT_PCT}%
- Stop Loss: -${config.STOP_LOSS_PCT}%
- Position Size: ${config.TRADE_SIZE_PCT}% of vault

Should I open a BUY position now?`.trim();

  try {
    const model = config.GEMINI_MODEL;
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,     // Low temperature for deterministic financial decisions
        maxOutputTokens: 256,
        responseMimeType: "application/json",
      },
    });

    const raw = response.text?.trim() ?? "";
    if (!raw) throw new Error("Empty LLM response");

    const decision: LlmDecision = JSON.parse(raw);

    // Validate schema
    if (typeof decision.approved !== "boolean" || typeof decision.confidence !== "number") {
      throw new Error(`Invalid LLM response schema: ${raw}`);
    }

    return decision;
  } catch (err) {
    console.warn(`[decision] Gemini call failed, falling back to threshold logic:`, err);
    return null;
  }
}

// ── Main Service ──────────────────────────────────────────────────────────
export class DecisionService {
  /**
   * Evaluates a cascade signal with Gemini AI reasoning, then produces a
   * TradeIntent if approved. Wrapped in the x402 payment flow.
   *
   * Flow:
   *  1. Pre-filter: score must be >= 40 to even call the LLM (saves API cost).
   *  2. LLM call: Gemini evaluates all signal components and returns structured JSON.
   *  3. Fallback: If no API key or LLM fails, falls back to pure CASCADE_SCORE_THRESHOLD.
   *  4. Intent: TP/SL/size always come from .env config — LLM cannot override risk params.
   */
  static async evaluateSignal(
    signal: CascadeSignal,
    currentPrice: number,
    snapshot?: MarketSnapshot
  ): Promise<TradeIntent | null> {
    const cost = "0.0005";
    const resource = `llm/verify/${signal.token}`;

    return X402Service.executeWithPayment<TradeIntent | null>(
      async (paymentHeader) => {
        if (!paymentHeader) {
          return { status: 402 };
        }

        console.log(
          `[decision] Evaluating signal for ${signal.token} ` +
          `(Score: ${signal.cascadeScore}%, Threshold: ${config.CASCADE_SCORE_THRESHOLD}%)`
        );

        // ── Pre-filter: weak signals never reach LLM ──────────────────
        if (signal.cascadeScore < 40) {
          console.log(`[decision] Signal SKIPPED (score ${signal.cascadeScore}% < pre-filter 40%)`);
          return { status: 200, data: null };
        }

        // ── LLM decision (Gemini) ─────────────────────────────────────
        let approved = false;
        let llmReasoning = "Threshold-only mode (no Gemini API key or Vertex AI configured)";
        const hasGemini = config.USE_VERTEX_AI === "true" || !!config.GOOGLE_CLOUD_PROJECT || (!!config.GEMINI_API_KEY && config.GEMINI_API_KEY !== "your_gemini_api_key_here");

        if (hasGemini && snapshot) {
          console.log(`[decision] Consulting Gemini (${config.GEMINI_MODEL})...`);
          const llmDecision = await consultGemini(signal, snapshot);

          if (llmDecision) {
            approved = llmDecision.approved && llmDecision.confidence >= 75;
            llmReasoning = `[Gemini ${llmDecision.confidence}% confidence] ${llmDecision.reasoning}`;
            console.log(`[decision] Gemini: approved=${llmDecision.approved}, confidence=${llmDecision.confidence}%`);
            console.log(`[decision] Reasoning: ${llmDecision.reasoning}`);
          } else {
            // LLM failed — fall back to threshold
            approved = signal.cascadeScore >= config.CASCADE_SCORE_THRESHOLD;
            llmReasoning = "Gemini unavailable — fallback to cascade score threshold";
          }
        } else {
          // No API key — pure threshold logic
          approved = signal.cascadeScore >= config.CASCADE_SCORE_THRESHOLD;
          if (!hasGemini) {
            console.warn(`[decision] ⚠️  No GEMINI_API_KEY — using score threshold only`);
          }
        }

        if (!approved) {
          console.log(`[decision] Signal REJECTED. Reason: ${llmReasoning}`);
          return { status: 200, data: null };
        }

        // ── Build TradeIntent — risk params always from config ────────
        const tpMultiplier = 1 + config.TAKE_PROFIT_PCT / 100;
        const slMultiplier = 1 - config.STOP_LOSS_PCT / 100;

        const intent: TradeIntent = {
          token: signal.token,
          side: "BUY",
          sizePct: config.TRADE_SIZE_PCT,
          entry: currentPrice,
          takeProfit: parseFloat((currentPrice * tpMultiplier).toFixed(6)),
          stopLoss: parseFloat((currentPrice * slMultiplier).toFixed(6)),
          timeStopCandles: config.EXIT_TIMEOUT_CANDLES,
        };

        console.log(`[decision] ✅ Signal APPROVED. Reason: ${llmReasoning}`);
        console.log(`[decision] Intent:`, {
          token: intent.token,
          entry: intent.entry,
          takeProfit: intent.takeProfit,
          stopLoss: intent.stopLoss,
          sizePct: intent.sizePct,
        });

        return { status: 200, data: intent };
      },
      resource,
      cost
    );
  }
}
