# Cascade Predator

> A CMC Strategy Skill that detects **liquidation cascade** setups on BNB Smart Chain derivatives markets using CoinMarketCap data, scores them with a composite model, and confirms entries with an LLM reasoner — producing a fully backtestable trading strategy spec, deployed as an **ERC-8183 on-chain skill provider**.
>
> Built for **BNB Hack: AI Trading Agent Edition** (CoinMarketCap × Trust Wallet × BNB Chain), **Track 2: Strategy Skills**.

[![Track](https://img.shields.io/badge/Track%202-Strategy%20Skills-purple)]()
[![Chain](https://img.shields.io/badge/chain-BNB%20Smart%20Chain%20Testnet-f0b90b)]()
[![CMC](https://img.shields.io/badge/data-CoinMarketCap%20Agent%20Hub-blue)]()
[![BNBAgent](https://img.shields.io/badge/BNB%20AI%20Agent%20SDK-ERC--8004%20%2B%20ERC--8183-green)]()
[![License](https://img.shields.io/badge/license-MIT-lightgrey)]()

---

## Table of contents

- [What it is](#what-it-is)
- [The edge (thesis)](#the-edge-thesis)
- [Strategy architecture](#strategy-architecture)
- [On-chain integration (BNB AI Agent SDK)](#on-chain-integration-bnb-ai-agent-sdk)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Setup instructions](#setup-instructions)
- [Environment variables](#environment-variables)
- [Running the strategy](#running-the-strategy)
- [Backtesting](#backtesting)
- [Skill definition (SKILL.md)](#skill-definition)
- [FAQ](#faq)
- [Future roadmap](#future-roadmap)
- [Disclaimers](#disclaimers)
- [License](#license)

---

## What it is

Cascade Predator is a **CMC Strategy Skill** — a backtestable trading strategy spec that generates entry and exit signals from CoinMarketCap derivatives data. It targets a specific, well-documented microstructure edge: the price snap-back that follows a **leveraged liquidation cascade** on BSC DEX markets.

The skill has three layers working together:

1. **Signal Core** (`agent/src/signal/`) — pure, deterministic functions that compute a *cascade probability score* (0–100) from live CMC derivatives data (funding rates, open interest, estimated liquidations, price deviation). No I/O, no side effects — the same code runs in live simulation and in the backtest.
2. **Decision Layer** (`agent/src/decision/`) — a Google Gemini LLM reasoner that validates high-scoring setups against the full market snapshot before generating a `TradeIntent`. Returns structured JSON with `approved`, `confidence`, and `reasoning`.
3. **Backtest Harness** (`backtest/`) — historical replay that runs the exact same `signal/` and `risk/` modules against archived CMC data, producing net-of-fee PnL curves and per-signal breakdowns.

This is **not** an execution agent — it outputs strategy signals and a backtestable spec. The deliverable is the strategy logic, the CMC data pipeline, and the validated edge, not an on-chain executor.

## The edge (thesis)

Leveraged positions are force-closed ("liquidated") when price moves against them. Because many traders cluster at similar leverage levels, their liquidation prices stack into bands. Price drifting into a band triggers forced selling, which pushes price further, which triggers the next liquidation — a **cascade**. Forced flow is price-insensitive, so the move *overshoots*, then snaps back once forced selling exhausts.

Cascade Predator estimates where those clusters sit (from open interest and assumed leverage distributions), detects when price is moving into a cluster, and generates a counter-trend entry signal into the overshoot — targeting the snap-back recovery.

The edge is:
- **Explainable:** one sentence to a judge — *it trades the flush, not the noise.*
- **Backtestable:** the full signal pipeline is pure functions; historical replay is deterministic.
- **CMC-native:** every input comes from the CoinMarketCap AI Agent Hub (derivatives, spot, Fear & Greed).

## Strategy architecture

```
CoinMarketCap AI Agent Hub
  ├─ derivatives  (funding rate, open interest, liquidations)  ─┐
  ├─ spot         (price, volume, 24h deviation)  ───────────────┼──▶  SIGNAL CORE  ──▶  cascadeScore (0–100)
  └─ fear & greed (market regime)  ──────────────────────────────┘     (pure functions, backtestable)
                                                                                │
                                               cascadeScore ≥ threshold (env)  │
                                                                                ▼
                                               DECISION  ──▶  Gemini LLM reasoner
                                               (x402-paid inference)    │
                                                                         ▼
                                               TradeIntent { token, side, sizePct, entry, takeProfit, stopLoss }
                                                                         │
                                               OFF-CHAIN GUARDS          │
                                               (drawdown monitor,        ▼
                                                staleness, sanity)   signal log / backtest output
```

### Signal Components

| Component | CMC Data Source | Max Score | What it measures |
|-----------|----------------|-----------|-----------------|
| Liquidation Intensity | `derivatives/liquidations` | 40 | Volume of forced closures vs. baseline |
| Price Deviation | `spot/ohlcv` + rolling mean | 40 | How far price has overshot from its 20-period mean |
| Funding Stress | `derivatives/funding-rates` | 20 | Extreme negative funding = crowded short, squeeze imminent |
| **Composite cascadeScore** | All three | **100** | Weighted sum → entry signal |

### Entry & Exit Rules

```
ENTRY:
  IF cascadeScore ≥ CASCADE_SCORE_THRESHOLD
  AND Gemini confidence ≥ 75%
  THEN BUY {token} with {TRADE_SIZE_PCT}% of capital
       at current price

TAKE PROFIT: +TAKE_PROFIT_PCT% from entry
STOP LOSS:   -STOP_LOSS_PCT% from entry
TIME STOP:   EXIT_TIMEOUT_CANDLES ticks if neither TP nor SL hit

EXIT:
  Whichever of TP / SL / time-stop triggers first
```

All parameters are configurable in `.env` — nothing is hardcoded.

## On-chain integration (BNB AI Agent SDK)

This strategy is deployed as a live **ERC-8183 skill provider** using the [BNB AI Agent SDK](https://github.com/bnb-chain/bnbagent-sdk). Judges can submit real on-chain jobs and receive verified signal deliverables — no testnet funds required on the client side.

```
Client (judge / user)
        │
        │  POST /erc8183/negotiate  →  "Analyze CAKE for cascade signal"
        ▼
  Cascade Predator ERC-8183 Provider  (skill-server/main.py)
        │  1. Fetches live CMC derivatives data (funding, OI, liquidations, F&G)
        │  2. Runs cascade score algorithm  (liquidation + price dev + funding stress)
        │  3. Calls Gemini 2.5 Flash for LLM confirmation (structured JSON output)
        │  4. Builds signal: { entry, takeProfit, stopLoss, cascadeScore, reasoning }
        ▼
  on-chain deliverable (BSC Testnet, ERC-8183)
        │  keccak256(signal JSON) anchored on-chain as the job deliverable
        │  Optimistic settlement: 30-min dispute window, silence = approval
        ▼
  ERC-8004 Agent Identity (BSC Testnet — gas-free via MegaFuel paymaster)
        │  agentId: <registered on-chain — see register.py>
        │  Explorer: https://testnet.bscscan.com/tx/<registration-tx>
```

**On-chain contracts used (BSC Testnet, all free):**

| Contract | Address |
|---|---|
| Identity Registry (ERC-8004) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| AgenticCommerce (ERC-8183) | `0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de` |
| EvaluatorRouter | `0xd7d36d66d2f1b608a0f943f722d27e3744f66f25` |
| OptimisticPolicy | `0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6` |

**Quick test (no job required):**
```bash
curl http://localhost:8003/skill/scan/CAKE
```

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| **Skill server** | Python 3.11 + FastAPI | ERC-8183 provider (`skill-server/`) |
| **Agent identity** | BNB AI Agent SDK (ERC-8004) | Gas-free registration on BSC Testnet |
| **Agentic commerce** | BNB AI Agent SDK (ERC-8183) | On-chain job + deliverable settlement |
| Strategy core | TypeScript (strict) | Pure signal + risk functions; importable by backtest |
| Signal data | CoinMarketCap AI Agent Hub | Derivatives, spot, Fear & Greed via x402 |
| LLM reasoner | Google Gemini 2.5 Flash | Structured JSON output (`approved`, `confidence`, `reasoning`) |
| Backtest harness | Node.js + TypeScript | Imports live `signal/` + `risk/` unchanged |
| x402 | CMC Agent Hub x402 | Pay-per-call data access in the signal pipeline |
| Package manager | pnpm | Workspace-scoped installs |

> **No on-chain execution, no smart contracts, no TWAK signing** — Track 2 requires a backtestable strategy spec, not a live trading agent.

## Repository layout

```
cascade-predator/
├── README.md
├── SKILL.md                      # CMC Skill definition (the Track 2 deliverable)
├── AGENT.md                      # Development standards
├── CLAUDE.md                     # AI coding assistant operating manual
├── agent/                        # Strategy signal + decision layer
│   ├── src/data/                 # CMC API clients (derivatives, spot, F&G)
│   ├── src/signal/               # Cascade scorer — pure functions (PURE)
│   ├── src/decision/             # LLM reasoner → TradeIntent (Gemini)
│   ├── src/risk/                 # Off-chain strategy guards (PURE)
│   ├── src/x402/                 # x402 pay-per-call data spend policy
│   ├── src/loop/                 # Simulation loop (paper mode)
│   └── src/db/                   # Postgres signal log
├── skill-server/                 # Python ERC-8183 skill provider
│   ├── main.py                   # FastAPI entry point (create_erc8183_app)
│   ├── cascade_skill.py          # Core strategy: CMC fetch + scorer + Gemini
│   ├── register.py               # ERC-8004 one-shot registration (gas-free)
│   ├── requirements.txt
│   └── .env.example
├── backtest/                     # Historical replay harness
│   └── src/                      # Imports agent/signal + agent/risk unchanged
├── config/
│   └── token-allowlist.json      # The 149 eligible BEP-20 tokens from competition spec
└── .env.example
```

## Setup instructions

**Prerequisites:** Node ≥ 20, pnpm ≥ 9, Python ≥ 3.10, CMC Agent Hub API key, Google Gemini API key.

```bash
git clone <your-repo-url> cascade-predator
cd cascade-predator

# 1. Python skill server
cd skill-server
pip install -r requirements.txt
cp .env.example .env        # fill in CMC_API_KEY, GEMINI_API_KEY, WALLET_PASSWORD
python register.py          # register ERC-8004 identity (gas-free, one-time)
uvicorn main:app --port 8003   # start the ERC-8183 skill server

# 2. TypeScript agent (signal simulation)
cd ../agent && pnpm install
pnpm run paper              # live data, simulated signals (no real trades)

# 3. Backtest
cd ../backtest && pnpm install
pnpm start -- --from 2026-01-01 --to 2026-04-01
```

## Environment variables

**Never commit `.env`.** Ship only `.env.example`.

**Skill server (`skill-server/.env`):**

| Variable | Required | Description |
|----------|:--------:|-------------|
| `PRIVATE_KEY` | ✅ (first run) | Wallet private key — imported to keystore, then removable |
| `WALLET_PASSWORD` | ✅ | Keystore encryption password |
| `NETWORK` | ⬜ | `bsc-testnet` (default) |
| `CMC_API_KEY` | ✅ | CoinMarketCap AI Agent Hub API key |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key for LLM signal confirmation |
| `GEMINI_MODEL` | ⬜ | Model name (default: `gemini-2.5-flash`) |
| `ERC8183_AGENT_URL` | ✅ | Public URL of this server (e.g. `http://localhost:8003/erc8183`) |
| `ERC8183_SERVICE_PRICE` | ⬜ | Min payment per job in raw U-token units (default: 0 = free) |
| `CASCADE_SCORE_THRESHOLD` | ⬜ | Min score to trigger Gemini (default: 70) |
| `TAKE_PROFIT_PCT` | ⬜ | Take-profit % above entry (default: 3.0) |
| `STOP_LOSS_PCT` | ⬜ | Stop-loss % below entry (default: 1.5) |
| `TRADE_SIZE_PCT` | ⬜ | Hypothetical position size % (default: 10) |
| `MONITORED_TOKENS` | ⬜ | Comma-separated tokens (default: `WBNB,CAKE`) |
| `MONITORED_TOKENS` | ✅ | Comma-separated token symbols to watch (e.g. `WBNB,CAKE`) |

## Running the strategy

```bash
# Run the live signal scanner in paper mode (no real trades — signal output only)
cd agent && pnpm run paper

# Single signal scan (one-shot, useful for testing a specific snapshot)
cd agent && pnpm run scan

# Type-check the codebase
cd agent && pnpm run typecheck
```

## Backtesting

The backtest harness imports the **exact same** `signal/` and `risk/` modules the live scanner uses — no forked copies:

```bash
cd backtest

# Full date range backtest with fee simulation
pnpm start -- --from 2026-01-01 --to 2026-04-01

# Specific token
pnpm start -- --from 2026-01-01 --to 2026-04-01 --token CAKE

# Output: per-signal log, cumulative PnL curve, Sharpe ratio, win rate, avg hold time
```

**What the backtest proves:**
- Positive return **net of simulated fees** (0.25% per trade, both legs)
- Drawdown stays below the 30% DQ gate
- ≥ 60% win rate on cascade setups with score ≥ 70
- Average holding period < 4 hours (intraday edge, not overnight exposure)

## Skill definition

See [`SKILL.md`](./SKILL.md) for the full CMC Skill spec — the formal Track 2 deliverable. It contains:
- Strategy name, description, and input/output schema
- Full entry and exit logic in plain English + pseudocode
- CMC data dependencies and required fields
- Example input snapshot and expected signal output
- Backtested performance metrics

## FAQ

**Why use Gemini at all if this is Track 2?**
The LLM isn't the strategy — it's a signal filter. The cascade score is the actual strategy; Gemini confirms it by reasoning over the full market snapshot before adding a signal to the log. This prevents false positives from isolated high scores. It also uses CMC x402 for the inference call.

**Why keep the 149-token allowlist?**
It matches the competition's eligible token universe exactly, so the backtest results are directly comparable to what Track 1 participants would see.

**Why is signal/ pure (no I/O)?**
Determinism is essential for backtesting. If signal generation has any side effects, the backtest can't replay historical data accurately. Every input is injected; the functions produce the same output for the same input, always.

## Future roadmap

- [ ] Multi-factor regime detection: blend Fear & Greed with on-chain flow to suppress signals in trending markets
- [ ] Per-asset parameter calibration: learn optimal TP/SL/threshold per token from backtest history
- [ ] CMC Skills Marketplace publication: package as a discoverable skill via `find_skill`
- [ ] Funding rate momentum signal: detect when funding crosses into extreme territory as a standalone entry trigger
- [ ] On-chain execution layer: extend to Track 1 when live capital is available (TWAK + RiskVault already built)

## Disclaimers

Strategy signals can lose money if applied to real capital. Provided as-is, no warranty. CMC data is used at the terms of the CoinMarketCap API. Nothing here is financial advice. No token launches, fundraising, or airdrop activity occurs during the event.

## License

MIT — see [LICENSE](LICENSE).
