# 🌌 Cascade Predator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![BNB Chain](https://img.shields.io/badge/BNB_Chain-F3BA2F?style=flat&logo=binance&logoColor=white)](https://www.bnbchain.org/)
[![Track: Strategy Skills](https://img.shields.io/badge/Track-Strategy_Skills-blue.svg)](#)

> **Market Regime-Aware Liquidation Cascade Hunter on BNB Chain**  
> Powered by CoinMarketCap Agent Hub (MCP), Trust Wallet Agent Kit (TWAK), and BNB Chain.

Cascade Predator is a fully autonomous trading agent, strategy skill, and research dashboard engineered to detect and profit from **liquidation cascades** on BNB Chain. It combines macro sentiment regime-awareness (to avoid trading in high-conviction uptrends) with deep on-chain derivatives data analysis (to identify forced deleveraging events).

---

## 📑 Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Core Thesis: The Liquidation Cascade](#2-core-thesis-the-liquidation-cascade)
3. [Architecture Deep-Dive](#3-architecture-deep-dive)
4. [The Cascade Algorithm](#4-the-cascade-algorithm)
5. [Trust Wallet Agent Kit (TWAK) & x402 Security](#5-trust-wallet-agent-kit-twak--x402-security)
6. [Resilience & Fallbacks](#6-resilience--fallbacks)
7. [Project Structure](#7-project-structure)
8. [Deployment & Quick Start](#8-deployment--quick-start)
9. [Backtest Research](#9-backtest-research)
10. [Roadmap](#10-roadmap)
11. [License & Disclaimer](#11-license--disclaimer)

---

## 1. Executive Summary

Most algorithmic trading systems fail because they treat all market environments the same. Cascade Predator solves this by splitting the problem into two distinct layers:
1. **The Macro Layer (Regime Gate)**: Uses CoinMarketCap's Agent Hub via a Python Skill Server to analyze fear, greed, and leverage states. It self-disables trading during highly euphoric, trending markets to prevent whipsaws.
2. **The Micro Layer (Execution)**: A TypeScript daemon monitors specific BNB Chain assets (WBNB, CAKE, FLOKI). When open interest spikes alongside extreme funding rates and lopsided taker volume, the agent calculates a "Cascade Score" and executes a mean-reversion trade.

---

## 2. Core Thesis: The Liquidation Cascade

In decentralized perpetual futures, traders use high leverage. When a market moves sharply in one direction, underwater positions are forcibly closed (liquidated) by the protocol. 

This creates a **Cascade**:
* A sudden price drop triggers long liquidations.
* The liquidation engine sells the asset at market price, driving the price down further.
* This triggers *more* liquidations.
* The result is a sharp, unnatural price wick followed by an immediate **mean-reversion bounce**.

**Cascade Predator hunts for the bounce.** By monitoring the precursors to a cascade (high open interest + extreme funding rates), the agent prepares to enter a position precisely when the cascade exhausts itself, capturing the mean-reversion profit.

---

## 3. Architecture Deep-Dive

Cascade Predator is built as a microservice architecture, ensuring separation of concerns between data analysis, secure execution, and user interface.

```text
                                  [ CoinMarketCap Agent Hub (MCP) ]
                                                │
                                                ▼ (detect_market_regime)
[ Next.js Web Dashboard ] ◄─── [ TypeScript Cascade Agent ] ◄─── [ Python Skill Server ]
       (Vercel)                 (Render Daemon, TWAK, x402)       (Render ERC-8183 Web App)
```

### 3.1. Python Skill Server (ERC-8183 Compliant)
The "brain" of the operation. This is a FastAPI Python application that exposes a standardized ERC-8183 Web3 skill endpoint. It connects to the **CoinMarketCap Agent Hub** using the Model Context Protocol (MCP) to fetch complex macro-indicators (Fear & Greed index, market conviction, leverage states).

### 3.2. TypeScript Cascade Agent (The Daemon)
The "muscle" of the operation. Written in Node.js/TypeScript, this background worker runs 24/7. It:
- Polls real-time spot and futures data for monitored tokens.
- Queries the Python Skill Server for the macro regime.
- Computes the mathematical **Cascade Score**.
- Manages virtual/paper positions (with logic ready for live DEX routing).

### 3.3. Next.js Web Dashboard
The "eyes" of the operation. A premium, responsive web interface hosted on Vercel. It features:
- **Scanner**: Live telemetry of all monitored tokens, their current Cascade Scores, funding rates, and open interest.
- **Positions & Ledger**: A historical record of all simulated trades, entry/exit reasons, and net returns.
- **Backtest**: Visualized equity curves and metrics comparing the raw strategy against the Regime-Gated strategy.

---

## 4. The Cascade Algorithm

The core algorithm is a scoring system (0 to 100) that evaluates four main pillars:

1. **Market Regime (The Gate)**: 
   If CoinMarketCap reports "High Greed" or a "Trending Up" regime, the Cascade Score is automatically zeroed out. Mean-reversion fails in trending markets.
2. **Open Interest (OI) Delta**:
   A sudden spike in Open Interest indicates massive leverage entering the system. The higher the OI relative to the 24h baseline, the higher the tension.
3. **Funding Rate Imbalance**:
   If the funding rate becomes extremely negative (shorts paying longs) or extremely positive (longs paying shorts), it indicates an overcrowded side of the market ripe for a squeeze.
4. **Taker Buy/Sell Volume Ratio**:
   Tracks the immediate aggression of market participants. A sudden divergence between price action and taker volume suggests capitulation.

When these factors align and the final **Cascade Score** crosses the entry threshold (e.g., 75/100), the system generates a signal.

---

## 5. Trust Wallet Agent Kit (TWAK) & x402 Security

Traditional trading bots use centralized API keys or hold raw private keys in memory. Cascade Predator uses Web3-native primitives:

* **No Plaintext Private Keys**: The agent wallet is encrypted into a local `twak-keystore.json` file.
* **x402 Micro-Payments**: Instead of a flat subscription for premium CoinMarketCap API endpoints, the agent pays per request. When querying premium data, the HTTP pipeline intercepts a `402 Payment Required` response.
* **TWAK Signing**: The agent uses the Trust Wallet Agent Kit (TWAK) to decrypt the keystore and sign an EIP-191 cryptographic payment proof. This proof is attached as a header, unlocking the data on the retry. 
* *Result*: Decentralized, secure, metered data consumption.

---

## 6. Resilience & Fallbacks

Hackathons and live markets require bulletproof code. Cascade Predator implements strict fallbacks:

* **Keystore Auto-Generation**: If the agent boots in a cloud environment (like Render) and `twak-keystore.json` is missing, it will automatically encrypt the raw private key from the environment variables, generate the keystore on the fly, and proceed without crashing.
* **Binance Futures Failover**: CoinMarketCap API plans have strict endpoint limitations. If a query to the CMC derivatives endpoint fails (e.g., due to an invalid data structure or authorization limit), the agent and skill server gracefully catch the exception and instantly route the query to the **public Binance Futures API** to fetch funding rates and open interest. The execution loop never dies.

---

## 7. Project Structure

The monorepo is divided into four distinct packages:

* [`/agent`](./agent): The TypeScript daemon. Contains TWAK keystore logic, Prisma database schemas, and the x402 interceptor.
* [`/skill-server`](./skill-server): The Python FastAPI ERC-8183 skill server hosting the CMC MCP integration.
* [`/frontend`](./frontend): The Next.js web dashboard.
* [`/backtest`](./backtest): An isolated Node.js script that replays historical market snapshots through the exact same logic used by the live agent to generate performance metrics.

---

## 8. Deployment & Quick Start

### Prerequisites
- Node.js (v18+) & `pnpm`
- Python 3.10+
- PostgreSQL Database URL
- CoinMarketCap Pro API Key
- BNB Chain Wallet Private Key

### 8.1. Skill Server (Python Backend)
```bash
cd skill-server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create .env
echo "CMC_API_KEY=your_key" > .env
echo "TWAK_ACCESS_ID=your_id" >> .env
echo "TWAK_HMAC_SECRET=your_secret" >> .env

# Run
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 8.2. Cascade Agent (TypeScript Daemon)
```bash
cd agent
npx --yes pnpm@latest install

# Create .env
echo "TWAK_WALLET_PASSWORD=your_password" > .env
echo "AGENT_PRIVATE_KEY=your_bsc_private_key" >> .env
echo "DATABASE_URL=postgresql://..." >> .env
echo "SKILL_SERVER_URL=http://localhost:8000" >> .env

# Build & Run
npx pnpm run db:generate
npx pnpm run build
node dist/index.js
```

### 8.3. Frontend (Next.js Dashboard)
```bash
cd frontend
npm install

# Create .env
echo "DATABASE_URL=postgresql://..." > .env
echo "SKILL_SERVER_URL=http://localhost:8000" >> .env

# Run locally or deploy to Vercel
npm run dev
```

*(Note: If deploying on Render, set up a cron job using a service like cron-job.org to ping the services every 14 minutes to prevent the free tier from spinning down).*

---

## 9. Backtest Research

We built a custom replay harness inside the `/backtest` directory to validate the thesis. 

To run it yourself:
```bash
cd backtest
pnpm install
pnpm start -- --from 2026-01-01 --to 2026-04-01
```

### The Impact of the Regime Gate
Replaying against Jan–Apr 2026 BSC derivatives data (WBNB, CAKE, FLOKI) shows the massive impact of integrating the CoinMarketCap **Market Regime Gate**:

| Metric | Raw Strategy (Pre-Gate) | Regime-Aware (Post-Gate) | Improvement |
| :--- | :--- | :--- | :--- |
| **Total Trades** | 6 | 4 | **-2 (avoided whipsaw)** |
| **Win Rate** | 33.33% | 50.00% | **+16.67%** |
| **Cumulative Return** | -9.60% | -1.95% | **+7.65%** |
| **Max Drawdown** | 9.60% | 7.81% | **1.79% Lower Risk** |

**Conclusion**: In strong trending markets (e.g., March 17–24, 2026), attempting to trade a cascade bounce results in painful stop-outs. The CMC Regime Gate correctly identified these macro structures and halted the agent, eliminating over a third of the drawdown.

---

## 10. Roadmap

- [ ] **Execution Layer**: Transition from paper-trading ledgers to active routing via 1inch/PancakeSwap routers for real BNB swaps.
- [ ] **Full CMC Derivatives Integration**: Transition derivatives sourcing entirely back to CoinMarketCap premium endpoints once API tier limits are upgraded.
- [ ] **Walk-Forward Stratification**: Implement walk-forward regime stratification for more granular entry thresholds.
- [ ] **Token Universe Expansion**: Expand the scanner beyond the top 5 BSC volume leaders to mid-cap assets where cascades are more violent.

---

## 11. License & Disclaimer

### License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

### Disclaimer
**Cascade Predator is experimental software.** The data, research, and algorithms provided by this repository do not constitute financial advice. Trading cryptocurrencies, especially using automated agents or leveraged derivatives, involves significant risk of capital loss. Use this software at your own risk. The developers are not responsible for any financial losses incurred through the use of this agent.
