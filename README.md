# 🌌 Cascade Predator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![BNB Chain](https://img.shields.io/badge/BNB_Chain-F3BA2F?style=flat&logo=binance&logoColor=white)](https://www.bnbchain.org/)
[![Track: Strategy Skills](https://img.shields.io/badge/Track-Strategy_Skills-blue.svg)](#)

> **Market Regime-Aware Liquidation Cascade Hunter on BNB Chain**  
> Powered by CoinMarketCap Agent Hub (MCP), Trust Wallet Agent Kit (TWAK), and BNB Chain.

Cascade Predator is an autonomous trading agent and strategy skill designed to detect and profit from liquidation cascades on BNB Chain. It combines macro sentiment regime-awareness (to avoid trading in high-conviction uptrends) with deep on-chain derivatives data analysis (to identify forced deleveraging events).

---

## 📑 Table of Contents
- [Motivation](#-motivation)
- [Architecture](#-architecture)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Quick Start & Deployment](#-quick-start--deployment)
- [Backtest Performance](#-backtest-performance)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)
- [Disclaimer](#-disclaimer)

---

## 💡 Motivation

In high-leverage decentralized markets, liquidation cascades pose significant risks for retail traders, but they also create the most profitable mean-reversion opportunities if detected early. Cascade Predator aims to democratize institutional-grade cascade detection. By leveraging CoinMarketCap's market sentiment data and Trust Wallet's Agent Kit for secure, decentralized API payments, we provide a robust, self-custodial engine for navigating extreme market volatility.

---

## 🏗️ Architecture

```text
                                  [ CoinMarketCap Agent Hub (MCP) ]
                                                │
                                                ▼ (detect_market_regime)
[ Next.js Web Dashboard ] ◄─── [ TypeScript Cascade Agent ] ◄─── [ Python Skill Server ]
       (Vercel)                 (Render Daemon, TWAK, x402)       (Render ERC-8183 Web App)
```

1. **Python Skill Server (ERC-8183)**: Houses the market regime detection skill. It interacts with the CoinMarketCap Agent Hub via MCP to determine the macro market state (fear, greed, conviction, leverage, and liquidation states).
2. **TypeScript Cascade Agent**: A background trading daemon that polls real-time metrics for monitored tokens (e.g., WBNB, CAKE, FLOKI). It queries the Skill Server for regime conviction and calculates final cascade scores.
3. **Trust Wallet Agent Kit (TWAK) & x402**: Handles secure local message signing via an encrypted keystore (`twak-keystore.json`) to provide metered, pay-per-request API access for premium data.
4. **Next.js Web Dashboard**: A premium, responsive interface showcasing live token scanners, positions ledger, backtest research, and strategy parameters.

---

## ⚡ Key Features

* **🛡️ Market Regime Gate**: Uses the CMC `detect_market_regime` MCP skill to self-disable the mean-reversion strategy during euphoric trending uptrends, preventing costly stop-out whipsaws.
* **🌊 Liquidation Cascade Engine**: Monitors spot quotes, funding rates, open interest, and taker long/short volume ratios to detect forced liquidations.
* **💳 Decentralized Payment Pipeline (x402)**: Authenticates and meters premium endpoint queries dynamically via EIP-191 signatures signed locally by TWAK.
* **🔄 Fail-Safe Fallback**: If the CoinMarketCap derivatives API is restricted by tier limits, the data layer automatically redirects inquiries to public Binance Futures endpoints to guarantee 100% uptime.

---

## 🛠️ Tech Stack

- **Agent Daemon**: Node.js, TypeScript, Prisma (PostgreSQL)
- **Skill Server**: Python, FastAPI, Uvicorn
- **Frontend**: Next.js, React, TailwindCSS
- **Web3 & Security**: Trust Wallet Agent Kit (TWAK), ethers.js, x402
- **Data Providers**: CoinMarketCap API, Binance Futures API

---

## 📂 Project Structure

* [`/agent`](./agent): TypeScript daemon, risk manager, TWAK keystore logic, and x402 payment handler.
* [`/skill-server`](./skill-server): Python ERC-8183 skill server hosting the regime analysis functions.
* [`/frontend`](./frontend): Next.js web application built with React, TailwindCSS, and chart components.
* [`/backtest`](./backtest): Historical replay harness with cached market snapshots (Jan-Apr 2026).

---

## 📝 Prerequisites

- Node.js (v18 or higher) & `pnpm`
- Python 3.10+
- A PostgreSQL Database (e.g., Supabase, Neon, local)
- A CoinMarketCap Pro API Key
- Trust Wallet Access ID & HMAC Secret
- A BNB Chain Wallet Private Key (for the Agent)

---

## 🚀 Quick Start & Deployment

### 1. Environment Variables Configuration

Create an `.env` file in the `/agent` directory with the following variables:
```env
TWAK_WALLET_PASSWORD=your_keystore_password
AGENT_PRIVATE_KEY=your_agent_bsc_wallet_private_key
BSC_RPC_URL=https://bsc-dataseed.binance.org
CMC_API_KEY=your_coinmarketcap_pro_api_key
SKILL_SERVER_URL=http://localhost:8000
DATABASE_URL=postgresql://...
```

Create an `.env` file in the `/skill-server` directory:
```env
CMC_API_KEY=your_coinmarketcap_pro_api_key
TWAK_ACCESS_ID=your_tw_access_id
TWAK_HMAC_SECRET=your_tw_hmac_secret
```

### 2. Deploying the Skill Server (Render)
1. Deploy `/skill-server` as a Web Service on Render.
2. Build Command: `pip install -r requirements.txt`
3. Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

### 3. Deploying the Cascade Agent (Render)
1. Deploy `/agent` as a Background Worker or Web Service on Render.
2. Build Command: `npx --yes pnpm@latest install && npx pnpm run db:generate && npx pnpm run build`
3. Start Command: `node dist/index.js`
4. **Keystore Configuration**: Ensure the `AGENT_PRIVATE_KEY` environment variable is set in the Render dashboard so the agent can auto-generate its TWAK keystore on startup.

### 4. Deploying the Frontend (Vercel)
1. Import the repository into Vercel.
2. Set the Root Directory to `frontend`.
3. Set the Environment Variables `DATABASE_URL` and `SKILL_SERVER_URL`.
4. Deploy.

---

## 📊 Backtest Performance (Regime Gate Impact)

To run a historical replay locally:
```bash
cd backtest
pnpm install
pnpm start -- --from 2026-01-01 --to 2026-04-01
```

Replaying the strategy against Jan–Apr 2026 BSC derivatives data shows the impact of the CoinMarketCap-powered **Market Regime Gate**:

| Metric | Raw Strategy (Pre-Gate) | Regime-Aware (Post-Gate) | Improvement |
| :--- | :--- | :--- | :--- |
| **Total Trades** | 6 | 4 | **-2 (avoided whipsaw)** |
| **Win Rate** | 33.33% | 50.00% | **+16.67%** |
| **Cumulative Return** | -9.60% | -1.95% | **+7.65%** |
| **Max Drawdown** | 9.60% | 7.81% | **1.79% Lower Risk** |
| **Stop-Loss Exits** | 4 | 2 | **Avoided 2 bad exits** |

*Note: In strong trending markets (e.g. March 17–24, 2026), the mean-reversion cascade strategy triggers false-breakout stop-outs. The CMC Regime Gate successfully detects these macro structures and halts the agent to eliminate drawdown.*

---

## 🗺️ Roadmap

- [ ] Transition derivatives data sourcing fully to CoinMarketCap premium endpoints once API tier limits are upgraded.
- [ ] Implement walk-forward regime stratification for more granular entry gates.
- [ ] Expand monitored token universe beyond top BSC volume leaders.
- [ ] Integrate on-chain execution layer via 1inch/PancakeSwap routers.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## ⚠️ Disclaimer

**Cascade Predator is experimental software.** The data, research, and algorithms provided by this repository do not constitute financial advice. Trading cryptocurrencies, especially using automated agents or leveraged derivatives, involves significant risk of capital loss. Use this software at your own risk. The developers are not responsible for any financial losses incurred through the use of this agent.
