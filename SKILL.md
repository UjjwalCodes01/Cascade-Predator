# SKILL.md — Cascade Predator Strategy Skill

**Skill Name:** `cascade-predator`
**Version:** 1.0.0
**Track:** BNB Hack Track 2 — Strategy Skills
**Author:** Cascade Predator (BNB Hack submission)
**Data Provider:** CoinMarketCap AI Agent Hub
**Execution Layer:** BNB AI Agent SDK (ERC-8004 identity + ERC-8183 commerce)

---

## Overview

Cascade Predator is a **liquidation cascade detection skill** that uses CoinMarketCap derivatives data to identify when a cluster of leveraged positions on BSC DEX markets is being force-closed, creating a predictable price overshoot and snap-back opportunity.

The skill accepts a token symbol, fetches live CMC derivatives data, computes a composite **cascade probability score**, and confirms high-confidence setups with a Google Gemini LLM. It returns a structured signal with an entry recommendation, confidence level, and full reasoning chain.

---

## CMC Data Dependencies

| CMC Endpoint | Fields Used | Why |
|---|---|---|
| `GET /v2/cryptocurrency/quotes/latest` | `price`, `volume_24h`, `percent_change_1h` | Current spot price + recent momentum |
| `GET /v1/cryptocurrency/market-pairs/latest` | `quote.open_interest` | Total leveraged exposure at risk |
| `GET /v2/cryptocurrency/funding-fee/latest` | `funding_rate` | Crowded directional positioning |
| `GET /v1/fear-and-greed/latest` | `value`, `value_classification` | Market-wide risk regime |

> All data fetched via **CoinMarketCap AI Agent Hub** with optional x402 pay-per-call access for premium data tiers.

---

## Signal Components

The cascade score is a weighted composite of three sub-signals. Each is normalized to its max weight.

### 1. Liquidation Intensity Score (max: 40 pts)

Estimates the volume of forced closures relative to baseline. Uses open interest and an assumed leverage distribution.

```
estimated_liquidations = open_interest × liquidation_proximity_factor
liquidation_intensity = clamp(estimated_liquidations / LIQIDATION_BASELINE, 0, 1)
liquidation_score = liquidation_intensity × 40
```

**High score (>25):** Heavy forced selling likely in progress.

### 2. Price Deviation Score (max: 40 pts)

Measures how far the current price has overshot below its recent rolling mean.

```
price_deviation_pct = (rolling_mean_price - current_price) / rolling_mean_price × 100
price_score = clamp(price_deviation_pct / MAX_DEVIATION_PCT, 0, 1) × 40
```

**High score (>25):** Price has moved far below mean — recovery expected.

### 3. Funding Rate Stress Score (max: 20 pts)

Extreme negative funding rates indicate crowded short positioning — a squeeze is imminent.

```
funding_stress = clamp(abs(min(funding_rate, 0)) / MAX_FUNDING_RATE, 0, 1)
funding_score = funding_stress × 20
```

**High score (>12):** Market paying heavily to be short — short squeeze risk elevated.

### Composite Score

```
cascadeScore = liquidation_score + price_score + funding_score   # 0–100
```

---

## Entry Logic

```
ENTRY CONDITION:
  IF cascadeScore >= CASCADE_SCORE_THRESHOLD (default: 70)
  AND fear_and_greed < 60                    (not euphoric — avoid chasing)
  AND LLM confidence >= 75%                  (Gemini confirms the setup)
  THEN generate LONG signal

POSITION SIZING:
  size = TRADE_SIZE_PCT% of hypothetical capital   (default: 10%)

ENTRY PRICE:
  entry = current market price at signal time
```

---

## Exit Logic

All three exit conditions are checked every candle tick. The **first** to trigger closes the position.

```
TAKE PROFIT:  exit when price >= entry × (1 + TAKE_PROFIT_PCT / 100)   (default: +3%)
STOP LOSS:    exit when price <= entry × (1 - STOP_LOSS_PCT / 100)     (default: -1.5%)
TIME STOP:    exit after EXIT_TIMEOUT_CANDLES ticks (default: 12)       (forced close, stale cascade)
```

---

## LLM Confirmation Layer (Gemini)

Before generating a signal, the skill calls Google Gemini with the full market snapshot. The LLM acts as a second-pass filter — it rejects setups that look mechanically high-scored but have structural problems (e.g. momentum still strongly negative, F&G extremely fearful suggesting continued downtrend rather than snap-back).

**Prompt structure:**
- System: Quantitative trading AI specializing in liquidation cascade snap-backs on BSC DEX markets
- User: Formatted market snapshot with all CMC fields + cascade score breakdown
- Output: Strict JSON `{ "approved": bool, "confidence": int, "reasoning": string }`

**Confidence gate:** Only signals with Gemini confidence ≥ 75 are approved.

## Output Schema

Every signal output is a structured JSON object:

```json
{
  "signal": {
    "token": "CAKE",
    "cascadeScore": 78.0,
    "components": {
      "liquidationIntensity": 32.0,
      "priceDeviation": 28.0,
      "fundingStress": 18.0
    },
    "approved": true,
    "confidence": 82,
    "reasoning": "CAKE shows extreme liquidation clustering near $2.30 support. Funding rate at -0.12% indicates heavy short positioning. Price has deviated 4.2% below 20-period mean. High probability of short squeeze and snap-back. Entering counter-trend long.",
    "entry": 2.3140,
    "take_profit": 2.38342,
    "stop_loss": 2.27929,
    "size_pct": 10.0,
    "time_stop_candles": 12,
    "market": {
      "token": "CAKE",
      "fundingRate": -0.0012,
      "openInterest": 4200000.0,
      "liquidations": 134000.0,
      "price": 2.3140,
      "fearGreed": 38,
      "timestamp": 1781827200000,
      "longShortRatio": 0.85,
      "takerBuySellRatio": 0.72
    },
    "timestamp": "2026-06-18T00:00:00Z"
  },
  "cascadeScore": 78.0,
  "components": {
    "liquidationIntensity": 32.0,
    "priceDeviation": 28.0,
    "fundingStress": 18.0
  },
  "confidence": 82,
  "reasoning": "CAKE shows extreme liquidation clustering near $2.30 support. Funding rate at -0.12% indicates heavy short positioning. Price has deviated 4.2% below 20-period mean. High probability of short squeeze and snap-back. Entering counter-trend long.",
  "market": {
    "token": "CAKE",
    "fundingRate": -0.0012,
    "openInterest": 4200000.0,
    "liquidations": 134000.0,
    "price": 2.3140,
    "fearGreed": 38,
    "timestamp": 1781827200000,
    "longShortRatio": 0.85,
    "takerBuySellRatio": 0.72
  }
}
```

**Rejected signal (score too low or LLM rejects):**
```json
{
  "signal": null,
  "cascadeScore": 18.19,
  "components": {
    "liquidationIntensity": 0.0,
    "priceDeviation": 0.0,
    "fundingStress": 18.19
  },
  "confidence": 0,
  "reason": "cascadeScore 18.19 below pre-filter threshold 40"
}
```

---


## Strategy Parameters (Configurable)

| Parameter | Default | Description |
|---|---|---|
| `CASCADE_SCORE_THRESHOLD` | `70` | Minimum composite score to trigger LLM confirmation |
| `TAKE_PROFIT_PCT` | `3.0` | Take-profit in % above entry |
| `STOP_LOSS_PCT` | `1.5` | Stop-loss in % below entry |
| `TRADE_SIZE_PCT` | `10` | Hypothetical position size as % of capital |
| `EXIT_TIMEOUT_CANDLES` | `12` | Force-exit after N ticks |
| `MONITORED_TOKENS` | `WBNB,CAKE` | Comma-separated tokens to scan |

---

## Backtest Methodology

The backtest uses the same signal + risk functions as the live scanner — no forked copies.

**Data:** CoinMarketCap historical OHLCV + derivatives (Jan–Apr 2026, BSC-listed tokens)
**Fee simulation:** 0.25% per leg (0.50% round-trip), applied to every trade
**Universe:** Subset of the competition's 149 eligible BEP-20 tokens

**Reported metrics:**
- Cumulative return (net of fees)
- Sharpe ratio (annualised)
- Win rate %
- Average holding period
- Maximum drawdown
- Total signal count vs. approved count (pre-filter effectiveness)

**Run the backtest:**
```bash
cd backtest && pnpm start -- --from 2026-01-01 --to 2026-04-01
```

---

## On-chain Integration (BNB AI Agent SDK)

This skill is deployed as an **ERC-8183 provider** using the BNB AI Agent SDK:

- **ERC-8004 identity:** Agent registered on BSC Testnet (gas-free via MegaFuel paymaster)
- **ERC-8183 jobs:** Clients submit "analyze {token}" jobs; the skill fetches CMC data, computes the cascade score, and submits the signal JSON as the on-chain deliverable
- **Payment:** Jobs settled in U tokens on BSC Testnet (free from faucet)
- **Dispute window:** 30-minute optimistic window; silence = approval

**Register the agent identity:**
```bash
cd skill-server
python register.py
# Output: Agent registered! ID: <agentId>, TX: <hash>
```

**Start the skill server:**
```bash
cd skill-server
uvicorn main:app --port 8003
```

**Submit a job (as client):**
```bash
POST http://localhost:8003/erc8183/negotiate
{ "description": "Analyze CAKE for liquidation cascade entry signal" }
```

---

## Eligible Token Universe

The 149 tokens from the competition spec. See `config/token-allowlist.json` for the full list. Key BSC-native tokens: WBNB, CAKE, FLOKI, CHEEMS, BabyDoge, TWT, AXS, PENDLE, STG, INJ.

---

## Files

| File | Purpose |
|---|---|
| `SKILL.md` | This file — formal skill definition (Track 2 deliverable) |
| `skill-server/main.py` | ERC-8183 FastAPI server entry point |
| `skill-server/cascade_skill.py` | Core strategy logic (CMC fetch + score + Gemini) |
| `skill-server/register.py` | ERC-8004 one-shot registration |
| `agent/src/signal/` | TypeScript signal core (pure functions, used by backtest) |
| `agent/src/decision/` | TypeScript Gemini decision layer |
| `backtest/` | Historical replay harness |
| `config/token-allowlist.json` | 149 eligible BEP-20 tokens |
