---
name: cascade-predator
description: |
  Detects liquidation cascade setups on BNB Smart Chain DEX markets by reading
  CoinMarketCap derivatives data (funding, open interest, liquidations) and
  regime context. Emits structured LONG entry signals with cascade probability
  score, sub-component breakdown, take-profit, stop-loss, and time-stop, gated
  by a market-regime self-disable check.
version: 1.0.0
author: Cascade Predator
homepage: https://github.com/rudraveersinghrathore/Cascade-Predator
data_sources:
  - cmc-agent-hub
  - cmc-x402
  - binance-futures
license: MIT
---

# Cascade Predator Skill

An installable strategy skill that detects liquidation cascade setups on BSC DEX markets and generates high-confidence, regime-aware LONG entry signals.

## Usage

This skill is designed to run within any CoinMarketCap-compatible agent runtime or as a standalone ERC-8183 service.

### Installation

Copy the `cascade-predator/` directory into your agent's skills path:

```bash
cp -r cascade-predator/ /path/to/your/agent/skills/
```

### Prompt Definition

The quantitative instructions are located in `prompts/analyze.md`. These instructions are injected into the agent's LLM context when executing a cascade evaluation.

### Inputs

The skill requires a single input parameter:
* `token`: The symbol of the BSC token to scan (e.g. `WBNB`, `CAKE`).

### Output Schema

The skill returns a structured JSON object representing the trading signal:

```json
{
  "signal": {
    "token": "CAKE",
    "cascadeScore": 75.0,
    "components": {
      "liquidationIntensity": 30.0,
      "priceDeviation": 25.0,
      "fundingStress": 20.0
    },
    "approved": true,
    "confidence": 85,
    "reasoning": "Clustering of forced liquidations and negative funding suggests short-term overshoot support.",
    "entry": 1.393,
    "take_profit": 1.4348,
    "stop_loss": 1.3721,
    "size_pct": 10.0,
    "time_stop_candles": 12,
    "market": {
      "token": "CAKE",
      "fundingRate": -0.0005,
      "openInterest": 4500000.0,
      "liquidations": 120000.0,
      "price": 1.393,
      "fearGreed": 42,
      "timestamp": 1781827200000,
      "longShortRatio": 0.82,
      "takerBuySellRatio": 0.75
    },
    "timestamp": "2026-06-21T00:00:00Z"
  },
  "cascadeScore": 75.0,
  "components": {
    "liquidationIntensity": 30.0,
    "priceDeviation": 25.0,
    "fundingStress": 20.0
  },
  "confidence": 85,
  "reasoning": "Clustering of forced liquidations and negative funding suggests short-term overshoot support.",
  "market": {
    "token": "CAKE",
    "fundingRate": -0.0005,
    "openInterest": 4500000.0,
    "liquidations": 120000.0,
    "price": 1.393,
    "fearGreed": 42,
    "timestamp": 1781827200000,
    "longShortRatio": 0.82,
    "takerBuySellRatio": 0.75
  }
}
```
