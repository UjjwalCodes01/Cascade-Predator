# PHASE_1.md — Connect & Ship

**Goal:** at the end of this phase, the Vercel-deployed frontend reads live data from the running agent and shows it on three working routes. Nothing beautiful yet. Nothing strategic yet. Just real, connected, deployed, truthful.

**Why this comes first:** Phase 2 (distinguishing visuals) and Phase 3 (prize-stacking work) both depend on a working pipeline. Build the pipes before the paint. If we ran out of time after only this phase, the submission would still be *valid* — a working autonomous agent with a live dashboard and on-chain proof. Not winning, but valid.

**Estimated scope:** ~1 day of focused work.

---

## Hard rules (re-stated for this phase)

1. **No contract changes.** `RiskVault.sol` at `0x0dae11b453fdfc8cbc71bbeeb9caa5c9a0778726` is locked. Use the deployed ABI only.
2. **No changes to `agent/src/signal/`, `agent/src/risk/`, or the Python `compute_cascade_score`.** Strategy is frozen.
3. **No secrets in `NEXT_PUBLIC_*` env vars.** Anything starting with `NEXT_PUBLIC_` is shipped to the browser.
4. **Read `frontend/AGENTS.md` before touching Next.js code.** It's Next.js 16 — assume your training data is wrong; check `node_modules/next/dist/docs/`.

---

## What "done" looks like for this phase

A judge clicking the Vercel URL sees:

- **`/` (Live):** the current cascade score for each monitored token, the score components beneath, and the active position (if any). Updates every few seconds. No fancy visuals — clean labelled numbers and basic styling.
- **`/ledger` (Proof):** a paginated list of trades from Postgres, with BscScan links on every tx hash; and beneath it, the x402 ledger.
- **`/backtest` (Edge):** the metrics from the committed backtest results, plus a basic line chart of cumulative return.

All three routes load without a wallet connection. Wallet is only needed for owner pause / withdraw — and that wallet button works, including all the edge cases below.

---

## Step 1 — Reconcile Prisma schemas across packages

The frontend's Prisma schema is out of sync with the agent's after Bug Fix 3. Until this is reconciled, the dashboard's ledger query will fail at runtime.

**Sync these in `frontend/prisma/schema.prisma`:**

```prisma
// BEFORE
model X402Ledger {
  id          String   @id @default(uuid())
  resource    String
  amountSpent String
  txHash      String?
  timestamp   DateTime @default(now())
}

// AFTER
model X402Ledger {
  id            String   @id @default(uuid())
  resource      String
  amountSpent   String
  paymentProof  String?
  timestamp    DateTime @default(now())
}
```

Cross-check every model (`Trade`, `Position`, `X402Ledger`, `Metric`) against `agent/prisma/schema.prisma` and bring them line-for-line into sync. They must match exactly because both packages connect to the same Postgres.

**Critical:** `pnpm prisma generate` (regenerates the client). **Do NOT** run `pnpm prisma migrate dev` from `frontend/` — the agent owns the schema, migrations only run from `agent/`. The frontend is a *reader*.

Verify by running `pnpm tsc --noEmit` in `frontend/` — type errors here mean the schemas drifted.

---

## Step 2 — Generate and commit the RiskVault ABI

The frontend needs the deployed contract's ABI to read on-chain state and to send owner transactions.

From `contracts/`:
```bash
forge inspect RiskVault abi --json > ../frontend/src/abi/RiskVault.json
```

Create the directory if it doesn't exist:
```bash
mkdir -p frontend/src/abi
```

Commit the JSON file. **Do not regenerate it from a different source** (e.g., a snapshot of the local contract code) — only the verified, deployed ABI is canonical. If `forge inspect` outputs an ABI different from what BscScan shows for the verified contract, stop and ask — that means the local Solidity is out of sync with the deployment, which is a bigger problem than this phase.

---

## Step 3 — Environment variables in Vercel

Set the following in the Vercel project settings under "Environment Variables." Use Vercel's secret storage; never commit a `.env` file.

| Var | Scope | Value / notes |
|-----|-------|---------------|
| `DATABASE_URL` | Server | Postgres connection string — same DB the agent writes to |
| `BSC_RPC_URL` | Server | Low-latency BSC mainnet RPC for server-side `eth_call` |
| `NEXT_PUBLIC_CHAIN_ID` | Public | `56` |
| `NEXT_PUBLIC_RISK_VAULT_ADDRESS` | Public | `0x0dae11b453fdfc8cbc71bbeeb9caa5c9a0778726` |
| `NEXT_PUBLIC_AGENT_ADDRESS` | Public | `0xbdABf4Ee1a03bb45950a8a4A737e9AD6B4A3a3B5` |
| `NEXT_PUBLIC_COMPETITION_CONTRACT` | Public | `0x212c61b9b72c95d95bf29cf032f5e5635629aed5` |
| `NEXT_PUBLIC_BSCSCAN_BASE` | Public | `https://bscscan.com` |
| `NEXT_PUBLIC_WALLETCONNECT_ID` | Public | WalletConnect Cloud project id (only if using WalletConnect) |

**Things that must NEVER be set in Vercel:** `CMC_API_KEY`, `TWAK_ACCESS_ID`, `TWAK_HMAC_SECRET`, `OWNER_PRIVATE_KEY`, the agent keystore, the x402 wallet key. The frontend has no business knowing any of these. If you find yourself reaching for one, stop — you're solving a problem the wrong way.

---

## Step 4 — Three Next route handlers (server-only data plumbing)

These are the bridge between Postgres / chain and the React tree. Server components and route handlers only — never expose Postgres to the client.

### `frontend/app/api/snapshot/route.ts`

Returns the current state needed by the Live view:

```ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic"; // never cache; this is live data

export async function GET() {
  try {
    // Latest metric row gives vault balance, daily volume/count, drawdown
    const latestMetric = await prisma.metric.findFirst({
      orderBy: { timestamp: "desc" },
    });

    // Open position(s), if any
    const openPositions = await prisma.position.findMany({
      where: { status: "open" },
      orderBy: { openedAt: "desc" },
    });

    // Most recent trade per token, for current score snapshot
    // (the agent should write a Trade-like row every tick — even if no swap fires;
    // if it doesn't, this query will look stale. See Step 5.)
    const recentTrades = await prisma.trade.findMany({
      orderBy: { timestamp: "desc" },
      take: 50,
    });

    return NextResponse.json({
      metric: latestMetric,
      openPositions,
      recentTrades,
      asOf: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Snapshot query failed", detail: String(e) },
      { status: 500 }
    );
  }
}
```

### `frontend/app/api/ledger/route.ts`

Paginated trades + x402 ledger:

```ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get("page") ?? "0"));
  const pageSize = 25;

  const [trades, x402, total] = await Promise.all([
    prisma.trade.findMany({
      orderBy: { timestamp: "desc" },
      skip: page * pageSize,
      take: pageSize,
    }),
    prisma.x402Ledger.findMany({
      orderBy: { timestamp: "desc" },
      take: 50, // x402 is short, no need to paginate yet
    }),
    prisma.trade.count(),
  ]);

  return NextResponse.json({ trades, x402, page, pageSize, total });
}
```

### `frontend/app/api/vault/route.ts`

Reads on-chain state directly from RiskVault (server-side, no signer):

```ts
import { NextResponse } from "next/server";
import { JsonRpcProvider, Contract } from "ethers";
import abi from "@/abi/RiskVault.json";

export const dynamic = "force-dynamic";
export const revalidate = 5; // cache for 5s; cheap relief on the RPC

export async function GET() {
  const provider = new JsonRpcProvider(process.env.BSC_RPC_URL);
  const vault = new Contract(
    process.env.NEXT_PUBLIC_RISK_VAULT_ADDRESS!,
    abi,
    provider
  );

  try {
    const [owner, agent, paused, maxBps, dailyVolume, dailyCount, dailyVolumeCap, dailyCountCap] =
      await Promise.all([
        vault.owner(),
        vault.agent(),
        vault.paused(),
        vault.maxPositionBps(),
        vault.dailyVolume(),
        vault.dailyCount(),
        vault.dailyVolumeCap(),
        vault.dailyCountCap(),
      ]);

    return NextResponse.json({
      owner,
      agent,
      paused,
      maxPositionBps: Number(maxBps),
      dailyVolume: dailyVolume.toString(),
      dailyCount: Number(dailyCount),
      dailyVolumeCap: dailyVolumeCap.toString(),
      dailyCountCap: Number(dailyCountCap),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Vault read failed", detail: String(e) },
      { status: 500 }
    );
  }
}
```

**Verify each route locally before deploying:** `curl http://localhost:3000/api/snapshot | jq .`. If the schema sync from Step 1 was right and `DATABASE_URL` is correct, you should see real data. If you see an empty array on `recentTrades`, the agent isn't writing — check the agent daemon's logs first, not the frontend.

---

## Step 5 — Agent's snapshot-write responsibility (the unspoken contract)

The Live view assumes the agent writes a row to a table on every tick — even when no swap fires — so the dashboard knows the current score per token. Audit `agent/src/loop/index.ts`:

- If the agent already writes per-tick to `Metric` or similar: fine, just confirm the score components are included.
- If it only writes when a trade fires: add a per-tick write to a `Snapshot` table (new model) containing `{ token, cascadeScore, components, fearGreed, timestamp }`. **This is a schema migration** — run it from `agent/` only.

The frontend needs this to show live scores. Without it, the Live page can only render trades, which are sparse.

**Important:** this is the *only* agent change Phase 1 needs. Don't get drawn into refactoring the agent loop while you're here. One narrow change, one migration, move on.

---

## Step 6 — Three minimal, working routes (no Orb yet)

Phase 1 ships *information*, Phase 2 ships *identity*. Keep the visuals simple here. Clean prose, monospaced numbers, dark `#0a0b0d` background, no library components.

### `app/page.tsx` — Live

A server component that initial-renders from `/api/snapshot`, then hands off to a client `LivePoller` that re-fetches every 5 seconds.

Show, per monitored token: token symbol, current price, cascade score (large monospaced numeral, no orb yet), the three component bars (simple `<div>` with width %), funding rate, fear & greed.

Show active position card: entry, take-profit, stop-loss, time-stop progress, current PnL.

Show stale state explicitly: if `asOf` is more than 30 seconds old, dim the page and show "agent quiet" — *not* "error."

Wallet connect button in top-right.

### `app/ledger/page.tsx` — Proof

A server component reading from `/api/ledger`. Two stacked tables: Trades (token in, token out, amount, cascade score, status, timestamp, BscScan link if `txHash`), and X402 Ledger (resource, amount, payment proof — link only if it's a tx hash, otherwise show the proof string with a copy button).

Pagination via `?page=N` querystring. No infinite scroll.

### `app/backtest/page.tsx` — Edge

A server component that reads `backtest/RESULTS.md` (or `backtest/results.json` if you exported one in Bug Fix 9) from the filesystem at request time. Render the metrics grid, and a single SVG line chart of the equity curve drawn from the trades CSV.

**Why filesystem read, not import:** keeps the backtest results data-only, so Phase 3's research-grade backtest doesn't require frontend code changes — just better data in the same files.

---

## Step 7 — Wallet button (the minimum that survives a judge)

Owner-only, used in Phase 1 just for **pause** and **withdraw**. Use `ethers` (already in `frontend/package.json` — don't add viem alongside it for Phase 1).

Handle these edge cases:

| Case | Behavior |
|------|----------|
| Wallet not installed | "Get MetaMask" link, not silent fail |
| Wallet locked | Prompt to unlock, with explanation |
| Wrong network | Button to switch to BSC mainnet (chainId 56) |
| Connection rejected | Friendly retry message |
| Account is not vault owner | Disable owner actions, explain why (with the actual owner address shown) |
| Account switched mid-session | Re-validate owner role |
| Chain switched mid-session | Block actions until back on BSC |
| Tx pending | Modal with BscScan link as soon as the hash is known |
| Tx replaced (sped-up / cancelled) | Detect via `tx.wait()` reject reason, follow new hash |
| Tx timed out (>2 min, no confirmation) | Surface with retry / give-up choice |

These are non-negotiable. A judge will try to break this flow. If wallet UX feels overwhelming, **defer withdraw to Phase 2** — pause alone is enough to demonstrate self-custody control in Phase 1.

---

## Step 8 — Vercel deploy

```bash
# Connect repo to Vercel; set root = frontend/
# Build command: pnpm install && pnpm prisma generate && pnpm build
# Env vars: per Step 3
```

After deploy:

1. Open the URL on a clean browser (no extension, incognito) — confirm `/`, `/ledger`, `/backtest` all load without wallet.
2. Open with MetaMask connected — confirm wallet button works, network switch works, owner check works.
3. Pull up the deployment logs and confirm `prisma generate` ran cleanly.
4. Verify there are no `process.env.SOMETHING_SECRET` references that ended up in the client bundle. Vercel's build will warn if a `NEXT_PUBLIC_` var is missing; it won't warn if you accidentally leaked a server secret — that's on you to verify. Run `grep -r "CMC_API_KEY\|TWAK_\|OWNER_PRIVATE_KEY" frontend/.next/static` after build; should return nothing.

---

## Phase 1 exit checklist

A phase is not done until every box is ticked.

- [ ] `frontend/prisma/schema.prisma` line-for-line matches `agent/prisma/schema.prisma`
- [ ] `frontend/src/abi/RiskVault.json` generated from `forge inspect`, committed
- [ ] All env vars in Vercel; secrets confirmed *not* in `NEXT_PUBLIC_*`
- [ ] `/api/snapshot`, `/api/ledger`, `/api/vault` all return 200 with real data
- [ ] Agent writes per-tick snapshot rows (verified by tailing the DB)
- [ ] `/` shows live scores updating every 5s, with "agent quiet" stale state
- [ ] `/ledger` shows trades with working BscScan links
- [ ] `/backtest` renders the committed Phase 1 backtest results
- [ ] Wallet button handles every edge case from Step 7 (or withdraw deferred to Phase 2 — pause must work)
- [ ] Deployed to Vercel; loads on incognito with no console errors
- [ ] No server secrets in the client bundle (grep verified)
- [ ] Tag the merge: `git tag v0.95-connected && git push --tags`

---

## What Phase 1 deliberately does not include

So the AI agent doesn't drift:

- The `CascadeOrb` hero element (Phase 2)
- Serif typography pairing (Phase 2)
- Animations of any kind beyond basic loading states (Phase 2)
- The regime-detection gate in the decision layer (Phase 3)
- CMC-native derivatives sourcing (Phase 3)
- Installable CMC Skill folder (Phase 3)
- Walk-forward backtest, regime-stratified results (Phase 3)
- Demo video, one-page PDF writeup (Phase 3)

If the temptation to "while we're here" creeps in, **stop**. The discipline of small phases is the whole reason they ship.
