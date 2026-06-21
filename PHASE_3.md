# PHASE_3.md — Win

**Goal:** stack the special prizes on top of the placement. Phase 1 made it work. Phase 2 made it distinctive. Phase 3 makes it *the* submission a CMC judge wants to highlight in the writeup. Four moves: CMC-native data sourcing, installable CMC Skill packaging, research-grade backtest, and the demo+writeup that ties everything together.

**Why this is Phase 3:** these are the moves that win prizes layered on top of a working system. Without Phase 1, there's no demo. Without Phase 2, there's no aesthetic story. Without Phase 3, there's still a competitive placement contender — but the $2k Best Use of Agent Hub prize, and the discretionary scoring on technical depth, both depend on what's in this phase.

**Estimated scope:** ~1.5 days. The CMC migration and the research-grade backtest are the largest chunks; the Skill folder and writeup are short but require care.

---

## Hard rules (re-stated)

1. **No contract changes.** Same as Phases 1 and 2.
2. **No changes to `agent/src/signal/`, `agent/src/risk/`, or `compute_cascade_score`.** Strategy heart still frozen. The CMC data migration changes the *source* of the inputs, not how they're scored.
3. **The committed backtest must remain reproducible.** If the new data sourcing changes inputs, version the historical data file and document the change in `RESULTS.md`. Don't silently regenerate.
4. **No new env vars in `NEXT_PUBLIC_*` that aren't safe for the browser.** Same as before.

---

## What "done" looks like for this phase

- The agent and the skill server source funding rate / open interest / liquidations via CMC's derivatives endpoints first, falling back to Binance only where CMC doesn't cover the token. The `SKILL.md` data table reflects reality.
- A `cascade-predator/` skill folder exists at the repo root, formatted to match CMC's official open-source skills repo — installable with `cp -r cascade-predator/ /path/to/agent/skills/`.
- The backtest is research-grade: walk-forward across 3+ non-overlapping windows, regime-stratified, with a baseline comparison and an honest loss-period section. Committed `RESULTS.md` is the artifact a judge reads.
- A 2–4 minute demo video shipped to YouTube/Loom, story-arc structured.
- A one-page PDF writeup attached to the DoraHacks submission.

---

## Step 1 — CMC-native derivatives sourcing

### Why this matters

Track 2 is a CoinMarketCap-judged hackathon. Right now the cascade signal pulls its three core inputs (funding rate, open interest, liquidations) from Binance Futures. The CMC layer is used for spot price + regime context only. A judge from CMC's team reads SKILL.md, sees Binance everywhere in the derivatives column, and the "Best Use of Agent Hub" prize ($2,000) falls off the table. This step alone is the highest-EV move in the entire phase.

### The migration

**Audit first:** call CMC's derivatives endpoints (`/v2/cryptocurrency/funding-fee/latest`, `/v1/cryptocurrency/market-pairs/latest`, derivatives via MCP) for every monitored token. Some will have data, some won't (small caps, BSC-native tokens).

Make a per-token decision matrix and commit it as `config/data-sources.json`:

```json
{
  "WBNB":   { "fundingRate": "cmc", "openInterest": "cmc",     "liquidations": "binance" },
  "CAKE":   { "fundingRate": "cmc", "openInterest": "binance", "liquidations": "binance" },
  "FLOKI":  { "fundingRate": "cmc", "openInterest": "cmc",     "liquidations": "cmc"     },
  "TWT":    { "fundingRate": "binance", "openInterest": "binance", "liquidations": "binance" }
}
```

This matrix is honest. CMC sees that every CMC-supported field has been moved off Binance — and the Binance fallback is documented as exception, not norm.

### Code change in `agent/src/data/index.ts`

Refactor `fetchSnapshot` to consult the matrix:

```ts
import dataSources from "@/config/data-sources.json";

async function fetchDerivatives(token: string, price: number): Promise<DerivativesData> {
  const sources = dataSources[token] ?? defaultBinanceAll;

  const [fundingRate, openInterest, liquidations] = await Promise.all([
    sources.fundingRate === "cmc"
      ? fetchCmcFundingRate(token)
      : fetchBinanceFunding(token),
    sources.openInterest === "cmc"
      ? fetchCmcOpenInterest(token, price)
      : fetchBinanceOpenInterest(token, price),
    sources.liquidations === "cmc"
      ? fetchCmcLiquidations(token)
      : fetchBinanceLiquidations(token, price),
  ]);

  return { fundingRate, openInterest, liquidations };
}
```

Mirror the change in `skill-server/cascade_skill.py`. Same matrix file, same per-token routing.

### Wrap the new CMC calls in x402

Now that the bug-fix x402 plumbing is real, **route the new CMC derivatives calls through `X402Service.executeWithPayment`** by default. This is the "Real, not a README mention" criteria — the agent is now paying CMC per-call for the data it actually trades on. Visible in the ledger. Provable on Base.

### Update `SKILL.md`

Re-do the data table to reflect what's actually happening:

```markdown
## Data Dependencies

| Source | Endpoint | Fields | Coverage |
|---|---|---|---|
| CMC Agent Hub (MCP) | `detect_market_regime` | regime, fear_greed, leverage_state, liquidation_state | All tokens |
| CMC REST (x402-metered) | `/v2/cryptocurrency/funding-fee/latest` | funding_rate | CMC-supported (see config/data-sources.json) |
| CMC REST (x402-metered) | `/v1/cryptocurrency/market-pairs/latest` | open_interest | CMC-supported |
| CMC REST | `/v2/cryptocurrency/quotes/latest` | spot price, volume_24h | All tokens |
| Binance Futures | `premiumIndex`, `openInterest`, `takerlongshortRatio` | fallback for non-CMC tokens | See data-sources.json |
```

Add a paragraph: "Per-token data sourcing is configured in `config/data-sources.json`. CMC is the default for all derivatives fields where CMC supports the token; Binance is the documented fallback for tokens outside CMC's derivatives coverage."

### Constraint: signal core stays frozen

The data layer is allowed to change *where* funding rate comes from. It is **not** allowed to change *how* funding rate maps to the cascade score — that's `agent/src/signal/computeScore`, which is locked.

### Backtest impact

The historical backtest was run on Binance-sourced inputs. If you re-run with CMC-sourced inputs, results will differ slightly because CMC's funding-rate is exchange-aggregated and Binance's is venue-specific. Two options:

1. **Run both, document both.** Commit `RESULTS-binance.md` and `RESULTS-cmc.md`, show that the strategy is robust across data sources. This is the stronger move.
2. **Run CMC only forward, keep Binance as historical baseline.** Less compelling but faster.

Option 1 if there's time; option 2 if not. Either way, be explicit about it in the docs.

---

## Step 2 — Re-author as an installable CMC Skill

### Why this matters

CMC's official open-source skills are distributed as folders that a user copies into their agent's skills directory. Each folder has a properly-formatted `SKILL.md` with `name`/`description` frontmatter, the prompts, and any helper code. **A judge from CMC's team can install our skill the same way they install their own.** That's the difference between "they built a thing that uses CMC" and "they extended CMC's platform." Worth real prize money on Best Use of Agent Hub.

### Folder structure

Create at the repo root:

```
cascade-predator/
├── SKILL.md                    # frontmatter + the actual skill spec
├── prompts/
│   └── analyze.md              # the LLM system prompt (extracted from cascade_skill.py)
├── scripts/
│   └── analyze.py              # thin entrypoint that imports from skill-server/
└── config/
    └── data-sources.json       # the matrix from Step 1, copied here as canonical
```

### `cascade-predator/SKILL.md` frontmatter

```markdown
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
homepage: https://github.com/<your-handle>/cascade-predator
data_sources:
  - cmc-agent-hub
  - cmc-x402
license: MIT
---
```

Cross-check the frontmatter shape against an actual CMC official skill (e.g., `coinmarketcap-official/skills-for-ai-agents-by-CoinMarketCap` → `skills/cmc-market`) before locking it. If their schema has additional fields, mirror them. The closer to their format, the more this reads as "first-class extension."

### Skill body

The body of `SKILL.md` describes:
1. When to use this skill (the natural-language description a host LLM uses to decide).
2. What inputs it takes (token symbol).
3. What it returns (the structured signal JSON, schema documented).
4. The strategy logic in plain English.
5. The regime gate behavior.
6. How to install: `cp -r cascade-predator/ <skills-dir>/`.
7. How to invoke: example `analyze("CAKE")` call.

### Make it truly standalone

The skill folder should work *without* the full repo cloned. The `scripts/analyze.py` entrypoint imports from `skill-server/` for now — but document that path in SKILL.md ("requires skill-server runtime, see homepage for full setup"). If time allows, refactor so the strategy logic is in a tiny standalone `cascade_predator_core.py` that lives inside the skill folder. Don't sweat this if it bloats the phase — the structural compliance with the CMC format matters more than the runtime independence.

### Reference in the main README

Add a section to the root README:

```markdown
## Installable CMC Skill

The strategy is packaged as a CoinMarketCap-format skill in `cascade-predator/`.
Install into any CMC-compatible agent:

cp -r cascade-predator/ /path/to/your/agent/skills/

See `cascade-predator/SKILL.md` for the full skill definition.
```

---

## Step 3 — Research-grade backtest

Phase 1 shipped an MVP backtest. Phase 3 turns it into a research artifact — the deliverable a Track 2 judge reads to decide whether the strategy is real.

### Walk-forward validation

The current backtest is one-shot over a single window (e.g., Jan–Apr 2026). Walk-forward = repeat the experiment across non-overlapping windows so the result isn't a single-period fluke:

```
Window 1:  Jan 1  – Feb 14
Window 2:  Feb 15 – Mar 31
Window 3:  Apr 1  – May 15
Window 4:  May 16 – Jun 21
```

Each window: run the strategy, report metrics. Then aggregate: cumulative return across all four, plus the per-window metrics in a table. **If any single window's result is dramatically out of line, that's a finding — surface it.**

### Regime stratification

Use the same `mcp_report.market_regime` field the gate keys off. Bucket every signal-fire by the regime at the time, and report metrics per bucket:

```
Regime               Trades   Win rate   Avg PnL   Cumulative
choppy_neutral       127      62%        +0.41%    +18.3%
fear                 64       58%        +0.52%    +12.1%
trending_up          0        —          —         0%      (gate blocks)
euphoric             0        —          —         0%      (gate blocks)
```

This table is the regime gate's justification, made empirical. It's the centerpiece of the submission.

### Baseline comparison

Compare against:

1. **Buy-and-hold:** equal-weighted portfolio across the monitored tokens, held the full period. Show the cumulative return.
2. **Random entry:** randomly long the same tokens at the same trade frequency, with same TP/SL. Average over 1000 runs. Show that the strategy beats random meaningfully.

Both baselines net of the same fees the strategy pays. **If the strategy doesn't beat both baselines, surface the gap honestly** and explain the conditions where it does win.

### Equity curve as committed SVG

The Phase 2 `EquityCurve` component renders a single line. Phase 3's `RESULTS.md` should embed a static SVG that shows:

- Strategy cumulative return (solid line).
- Buy-and-hold benchmark (dashed line).
- Drawdown shaded beneath (subtle).
- Vertical guides at each walk-forward window boundary.
- The honest-loss period highlighted.

This SVG is the image that ends up in the demo video and the one-page PDF.

### Honest loss-period analysis

Pick the worst contiguous loss window from the backtest. Write a short paragraph: *what was the regime, why did the strategy fail there, what the regime gate does about it, and what residual risk remains*. Two sentences of honesty here are worth more than a paragraph of stats inflation.

### Reproducibility

A judge running `cd backtest && pnpm start -- --from <date> --to <date>` should reproduce the numbers in `RESULTS.md` exactly. Pin the historical data snapshots; commit them (or, if they're too big, commit a checksum and a script to download them). The strategy is deterministic; the inputs must be too.

### `backtest/RESULTS.md` outline

```markdown
# Cascade Predator — Backtest Results

## Headline (Walk-forward aggregate, regime gate active)

Cumulative return        +X%
Max drawdown             −X%
Sharpe ratio              X.XX
Win rate                  X%
Trades                    XXX
Period                    Jan 1 – Jun 21, 2026
Net of fees               0.25% per leg

## Equity Curve

[SVG embedded]

## Walk-forward windows
[table]

## Regime stratification
[table]

## Baseline comparison
[table]

## Where it fails
[honest paragraph]

## Reproducibility
[command + data version + checksum]
```

This document, on its own, is what makes the placement competitive.

---

## Step 4 — The demo video (2–4 minutes)

The demo carries 25% of Track 2 scoring. Don't wing it.

### Storyboard

Each beat below has a target time. Total: ~3 minutes.

**0:00–0:20 — Open on a cascade.**
Screen-capture a real cascade event from the live data (or from the backtest replay if no live event is fresh enough). Price line drops fast. Voiceover: "This is a liquidation cascade. Forced selling overshoots, then snaps back. We trade the snap-back."

**0:20–0:55 — The dashboard responds.**
Cut to the live dashboard. Orb at quiet state. Score begins climbing. Show the component bars filling in. Threshold crosses — ignition transition fires. Position opens. Time-lapse to position close at TP.

**0:55–1:30 — Self-custody, autonomous, on-chain.**
Cut to BscScan. Show the agent's `executeSwap` tx hash. Show that it was signed by the agent EOA `0xbdABf4Ee1a03bb45950a8a4A737e9AD6B4A3a3B5` and that the RiskVault `0x0dae11b…aed5` enforced the size and slippage caps. Show the owner kill-switch on the dashboard, click it, show the `paused()` state change on BscScan.

**1:30–2:00 — The regime gate.**
Pull up a moment from the backtest where the regime was trending-up. Show the dashboard's Orb in the regime-blocked state (desaturated grey, "regime: trending — gate active"). Show the rejection log: `"Regime gate active: cascade strategy requires choppy/fear regime."` Cut to the regime-stratification table from RESULTS.md.

**2:00–2:30 — CMC-native, x402-metered.**
Pull up `cascade-predator/SKILL.md`. Show the frontmatter. Show the `cp -r` install instruction. Cut to the x402 ledger view — payment proofs lining up against CMC endpoint calls. Show one CMC tx hash on Base.

**2:30–end — The close.**
One sentence on screen, voiceover: "Cascade Predator: a CMC Skill, regime-aware, backtested across four walk-forward windows, with a self-custodial agent already running on BSC mainnet to prove it works."
End card: GitHub repo URL, Vercel URL, agent address, RiskVault address.

### Recording

- 1080p minimum, 60fps if the dashboard animations require it.
- Quiet mic, no AI voice — judges can tell.
- No background music. Let the dashboard's tone carry it.
- Cut tight. If a beat takes 8 seconds, give it 6.
- Upload unlisted to YouTube or Loom. Link in submission.

---

## Step 5 — The one-page PDF writeup

Judges skim. The PDF is what they print, scribble on, and refer back to. One page. Dense without being cluttered.

### Layout

A4 or US Letter, portrait, ~12pt body, ~24pt title, three columns max.

### Structure

```
CASCADE PREDATOR
A regime-aware liquidation cascade skill for BNB Smart Chain.

THE INSIGHT
Mechanically-forced liquidations create predictable price overshoots
that mean-revert within minutes. We score the setup with CMC derivatives
data, gate by regime, and trade the snap-back.

HOW IT WORKS
[Three-line diagram or bullet sequence: data → score → regime gate → LLM → execute]

BACKTEST
[The equity-curve SVG from RESULTS.md, half-page width]

[Metrics grid, half-page width: return, MDD, Sharpe, win rate, vs buy-and-hold]

WHY IT'S CMC-NATIVE
- Derivatives sourcing via CMC AI Agent Hub (per-token matrix in config/)
- x402-metered: every CMC call paid in USDC on Base, ledgered
- Regime gate uses CMC's market_regime, leverage_state, liquidation_state
- Skill packaged in CMC's official format (cp -r cascade-predator/ to install)

PROOF IT'S LIVE
- Agent EOA:    0xbdABf4Ee1a03bb45950a8a4A737e9AD6B4A3a3B5
- RiskVault:    0x0dae11b453fdfc8cbc71bbeeb9caa5c9a0778726
- Real trade:   [tx hash]
- Repo:         [URL]
- Dashboard:    [URL]
- Demo video:   [URL]

WHO USES IT
A self-custody trader who wants an autonomous agent that respects regime
and refuses to trade when the strategy is wrong. Installable as a CMC
Skill into any compatible agent.
```

That's the whole document. One page. The agent addresses and tx hashes are the proof — they're what a judge clicks first.

### Export

Markdown to PDF via Pandoc, or directly in a tool like Typst. Use the same typography as the dashboard (Instrument Serif + JetBrains Mono) if the export pipeline supports it; if not, a neutral serif + a neutral mono. Don't ship in default Pandoc styling — it reads as "this was an afterthought."

---

## Step 6 — Final submission packaging

Before hitting submit on DoraHacks:

### Repo cleanup

- All three phases merged. Tag `v1.0-submission`. Push tags.
- README updated to reference the live dashboard URL, the demo video URL, the installable skill, and the backtest results.
- All `.env` files, keystores, and `.agent-registration.json` artifacts confirmed *not* in the repo.
- Run a clean clone in a fresh directory: does `pnpm install && pnpm build && cd skill-server && uvicorn main:app` get a stranger to a working state? If not, fix the gaps in the README.

### DoraHacks submission text

- Agent address (with BscScan link).
- RiskVault address (with BscScan link).
- At least one real trade tx hash (with BscScan link).
- GitHub repo URL.
- Vercel dashboard URL.
- Demo video URL.
- One-page PDF attached.
- Strategy write-up: ~200 words summarizing the insight, the regime gate, the backtest result, the on-chain proof.

### Sanity reads of the live system before submitting

The dashboard URL must work, the agent must be running, the BscScan links must resolve. The one thing more painful than not submitting is submitting a link that doesn't load.

---

## Phase 3 exit checklist

- [ ] `config/data-sources.json` committed with per-token matrix
- [ ] `agent/src/data/index.ts` and `skill-server/cascade_skill.py` route via the matrix
- [ ] New CMC calls wrapped in `X402Service.executeWithPayment`
- [ ] `SKILL.md` data table reflects reality (CMC primary, Binance documented fallback)
- [ ] `cascade-predator/` folder exists at repo root with proper CMC-format frontmatter
- [ ] Root README links to the installable skill and includes the `cp -r` install line
- [ ] Backtest re-run with walk-forward across 3+ windows, results in `RESULTS.md`
- [ ] Regime stratification table in `RESULTS.md`
- [ ] Buy-and-hold + random-entry baselines documented in `RESULTS.md`
- [ ] Honest loss-period section written
- [ ] Static equity-curve SVG committed in `RESULTS.md`
- [ ] Backtest reproducibility verified (run from clean clone, numbers match)
- [ ] Demo video recorded, uploaded, linked from README
- [ ] One-page PDF writeup created and attached to DoraHacks
- [ ] DoraHacks submission complete with all links resolving
- [ ] Tag `v1.0-submission` pushed
- [ ] Live agent confirmed running and writing snapshots through to trading-window start

---

## A final word

Phase 1 made it work. Phase 2 made it visible. Phase 3 makes it win prize money.

If at any point a Phase 3 step starts feeling like it might break Phase 1 or Phase 2 — for example, if the CMC migration breaks the live dashboard, or the backtest rewrite breaks the committed RESULTS — **stop and roll back**. The hierarchy is: working > distinctive > winning. Never sacrifice the lower tier for the higher one. A live submission with a basic backtest beats a beautiful submission with a broken dashboard every single time.

Good luck.
