# PHASE_2.md — Distinguish

**Goal:** turn the working-but-plain Phase 1 dashboard into something that *visually is* the strategy. Build the `CascadeOrb`. Add the regime self-disable gate (originality hook). Polish the backtest page from "metrics + line" to "research artifact." After this phase, anyone who sees a screenshot knows it's Cascade Predator, not a generic AI agent dashboard.

**Why this is Phase 2 and not Phase 1:** identity is wasted on a system that doesn't work. Phase 1 proved the pipes; Phase 2 makes the surface unmistakable. If you only have time to ship Phase 1 + Phase 2 (no Phase 3), you have a competitive placement contender — well-built, distinctive, and rated for the demo + presentation criteria. Phase 3 is what stacks the special prizes on top.

**Estimated scope:** ~1.5 days. The Orb alone is half a day if done properly. Don't rush it; it's the single most memorable element of the entire submission.

---

## Hard rules (re-stated for this phase)

1. **No contract changes.** Same as Phase 1.
2. **No changes to `agent/src/signal/`, `agent/src/risk/`, or `compute_cascade_score`.** Strategy heart stays frozen.
3. **The regime gate goes in `agent/src/decision/`, not in `signal/`.** The decision layer is allowed to *reject* a candidate the signal layer found — that's its job. The signal layer must remain pure.
4. **No UI component library.** No shadcn, no Radix-heavy imports, no MUI. The whole point of distinguishing is hand-built. Aria primitives only where strictly needed for accessibility (focus traps in the withdraw modal, etc.).
5. **No charting library.** SVG by hand. Equity curve is one deliberate component, not a Recharts template.
6. **Read `frontend/AGENTS.md`** — Next.js 16; check `node_modules/next/dist/docs/` before assuming an API.

---

## What "done" looks like for this phase

- `/` (Live) is unrecognizable from Phase 1 — the **`CascadeOrb`** is centered as the hero, breathing at low scores, climbing as scores rise, and **igniting** with a single hard transition when threshold is crossed. Active position is integrated with the orb's interior, not a card next to it.
- `/backtest` (Edge) shows a hand-drawn equity curve that draws itself in over ~1.5 seconds when the page loads, plus a metrics grid in the distinctive typography. Linked from there: the regime-stratified breakdown (which Phase 3 will produce — for now the page can show "regime breakdown pending").
- `/ledger` (Proof) is the same as Phase 1 but with the typography upgrade applied. It's the most utilitarian view by design.
- The **regime gate** is live in the agent. When CMC's regime is trending/euphoric, the agent rejects candidate signals with a clear `reason` — and the dashboard surfaces this state on the Orb itself (more on that below).

---

## Step 1 — The typography pairing

Before any component work, lock in the type system. This is the single most important visual decision; everything else follows.

**Serif numerals for the score, monospace for everything else, no third font.**

In `frontend/app/layout.tsx`, replace the existing `Geist` + `Geist_Mono` setup with a deliberate pairing:

```tsx
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";

const displaySerif = Instrument_Serif({
  weight: ["400"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const dataMono = JetBrains_Mono({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// ... add both variable classes to <html>
```

In `globals.css`, define semantic tokens:

```css
:root {
  /* Color tokens */
  --cs-bg-deep: #0a0b0d;          /* near-black, faint cool cast */
  --cs-bg-card: #111316;
  --cs-stroke: rgba(255,255,255,0.06);
  --cs-text-primary: #e9edf2;
  --cs-text-muted: #6c7480;

  /* Score band colors */
  --cs-quiet: #4d6478;             /* cool steel — score 0-40 */
  --cs-warm: #d99257;              /* warm amber — score 40-70 */
  --cs-hot: #e34b3a;                /* signal red — score 70-100 */

  /* Position state */
  --cs-positive: #5fb38a;
  --cs-negative: #e34b3a;

  /* Motion */
  --cs-ease: cubic-bezier(0.16, 1, 0.3, 1);
}

body {
  background: var(--cs-bg-deep);
  color: var(--cs-text-primary);
  font-family: var(--font-mono);
}

.font-display { font-family: var(--font-serif); }
.font-data    { font-family: var(--font-mono); }
```

**Why these choices:**
- Instrument Serif on the numerals reads as *intent* rather than metrics — the score becomes a position, not a readout.
- JetBrains Mono everywhere else keeps the data feel without the desktop-app coldness of system mono fonts.
- No third font. Resist the urge to add a "label" or "small caps" face.

Don't skip this step. The Orb depends on the serif numerals to land.

---

## Step 2 — The `CascadeOrb`

This is the single highest-leverage component in the entire submission. Build it carefully.

### Visual specification

- **Form:** a circle, 360px diameter on desktop, centered in the upper portion of the viewport. Mobile: scales down to 280px, still centered.
- **Numeral:** the cascade score (0–100) at the orb's center, rendered in the display serif at ~140px, regular weight. No suffix, no "score" label — the orb *is* the score.
- **Ring:** a thin SVG circle outside the numeral, ~3px stroke, with `stroke-dasharray` set such that the visible arc length equals the score / 100 of the full circumference. Start angle at -90° (top).
- **Three sub-component bars beneath the orb:** Liquidation Intensity (0-40), Price Deviation (0-40), Funding Stress (0-20). Each bar is a thin horizontal track ~140px wide, with a fill that animates on update. Labels in the monospace font at small size, muted color.
- **Beneath the bars (when no active position):** a small row showing token symbol, current price, and "armed at" threshold value. Use monospace.
- **Beneath the bars (when active position open):** entry, TP, SL prices with a small horizontal "ladder" showing current price between SL and TP. Time-stop progress as a thin horizontal bar that drains left-to-right over the time-stop window.

### States and behavior

| State | Trigger | Visual |
|-------|---------|--------|
| **Quiet** | score < 40 | Ring color `--cs-quiet`. Soft 2-second pulse (3% scale, no opacity flicker). Numeral stable. |
| **Climbing** | 40 ≤ score < threshold | Ring color interpolates `--cs-quiet` → `--cs-warm` as score rises. Pulse speed increases linearly toward 1s period at threshold. Each new component update briefly flashes the relevant bar (scale 1 → 1.04 → 1, 240ms). |
| **Igniting** | score crosses threshold (one-shot, ~600ms) | Ring snaps to `--cs-hot`, full saturation. Numeral scales 1 → 1.1 → 1 over 300ms. A single hairline horizontal SVG line shoots across the page tracing the entry price level (an animated `stroke-dasharray` from 0 to full width over 400ms, then fades over 200ms). |
| **Live position** | position is open | Ring stays `--cs-hot` at lower opacity. Orb's interior shows a subtle radial gradient — green-tinted as price moves toward TP, red-tinted toward SL. PnL % shown small beneath the numeral in monospace, positive in `--cs-positive`, negative in `--cs-negative`. |
| **Exit (TP hit)** | position closes profitably | Ring flashes `--cs-positive` (600ms), numeral resets to 0 over 800ms with subtle decel ease, orb returns to Quiet. |
| **Exit (SL or time-stop)** | position closes at loss | Ring flashes `--cs-negative` (600ms), same reset. |
| **Regime-blocked** | regime gate is rejecting candidates | Ring color shifts to a desaturated grey; a small text node above the orb reads "regime: trending — gate active." This is the originality hook made visible. |
| **Stale (agent quiet)** | last DB write > 30s old | Ring drops to 40% opacity. Text "agent quiet" above the orb. No pulse. |

### Implementation guidance

- **Drive animations with `requestAnimationFrame` and CSS variables**, not a library. The orb is one `<div>` with SVG inside and CSS vars (`--cs-current-color`, `--cs-pulse-period`, `--cs-numeral-scale`) updated each frame. This gives you total control and ~2KB of dependencies versus Framer Motion's ~50KB.
- **The state machine is the source of truth.** Build a tiny `useOrbState(score, components, position, regime, lastUpdate)` hook that returns `{ mode, ringColor, ringDashOffset, pulsePeriod, numeralScale, regimeText }`. The component is dumb; the hook computes derived state. This makes the ignition transition trivial to test.
- **Server-render the initial state** from the DB so there's no flash-of-zero on page load. The orb mounts already showing the current score.
- **One-shot animations need a key prop trick**: when transitioning to Igniting, wrap the ignition flash in a `<div key={ignitionKey}>` whose key changes on each ignition event so React fully remounts it. This is more reliable than trying to reset animations with `animation: none → animation: ignite`.

### Acceptance criteria

A judge watching the demo should be able to *feel* the threshold cross without being told what the threshold is. The ignition transition is the moment of the demo video. If the transition doesn't make the team go "oh," redo it.

---

## Step 3 — Wire the regime self-disable gate

This is the originality hook for Track 2 — the brief literally cites "a regime-detection Skill that switches strategy based on derivatives positioning" as an example. We're going one step further: the strategy *refuses to trade* in the wrong regime.

### In `agent/src/decision/index.ts`

Before the LLM call, add a regime check:

```typescript
// Gate: cascades only mean-revert in choppy/fear regimes.
// In trending or euphoric regimes the strategy is wrong; refuse to trade.
const BLOCKED_REGIMES = ["trending_up", "trending_strong_up", "euphoric"];

const regime = snapshot.mcpReport?.market_regime;
if (regime && BLOCKED_REGIMES.includes(regime)) {
  return {
    approved: false,
    confidence: 0,
    reasoning: `Regime gate active: cascade strategy requires choppy/fear regime, current is "${regime}". Standing aside.`,
    regimeGateBlocked: true,   // surface this so the dashboard can show it
  };
}
```

Add the `regimeGateBlocked: boolean` field to the LLM decision type and propagate it through to the snapshot that the agent writes to Postgres (Phase 1 Step 5). The frontend reads this and triggers the Orb's `Regime-blocked` state.

### In `skill-server/cascade_skill.py`

Mirror the same gate in `analyze_token` just before the Gemini call. Same blocked regime list. Same `regime_gate_blocked` field in the output JSON.

### Tunable, not hardcoded

Make the blocked-regime list an env var (`BLOCKED_REGIMES`, comma-separated) so you can adjust during the trading week if CMC's regime labels turn out to be different from what you expect. Default to the list above.

### Important constraint

The gate goes in **decision**, not **signal**. The signal still scores the setup mechanically; decision decides whether to act. If you put the gate in signal, you've broken the locked signal contract and invalidated the committed backtest.

### Backtest impact

The regime gate changes which signals would have fired historically. **Re-run the committed backtest with the gate active**, and commit the new `RESULTS.md` (with both pre-gate and post-gate metrics in a table). This is honest and lets a judge see the gate's contribution to performance.

---

## Step 4 — Polish the backtest page

Phase 1 shipped a basic metric grid + line chart. Phase 2 makes it a research artifact.

### `EquityCurve` SVG component

A hand-drawn SVG line chart. Single line for cumulative return. Hand-drawn meaning:
- Axes are thin, lots of whitespace, ticks every meaningful interval (every 10 days, or every 10% return).
- Line color is `--cs-text-primary` at 90% opacity. No "area below" fill.
- A horizontal `--cs-warm` dashed line at the buy-and-hold final return for comparison. Labeled small.
- **The line draws itself in on page load** — `stroke-dasharray` animation from 0 to total length over 1500ms with `var(--cs-ease)`. This is the second memorable visual moment after the Orb ignition.

### Metrics grid

A grid of numbers in the display serif:

```
Cumulative return        +34.2%
Max drawdown             -8.7%
Win rate                 58%
Sharpe ratio             1.84
Avg holding period       42 min
Trade count              211
                         ────────────
Buy-and-hold benchmark   +12.1%
Outperformance           +22.1pp
```

Numbers in serif (large), labels in mono (small, muted). Right-align numbers.

### Honest loss period callout

Beneath the metrics, a small section titled "Where it fails." Pick the worst calendar window from the backtest, show the period, the drawdown, and one sentence: "In trending-up regimes (e.g., March 17–24, 2026) the strategy loses 4–6% as cascade setups don't mean-revert. The regime gate (Phase 2) eliminates this category of loss."

This single section is what separates this submission from the 200 others. Judges who've seen too many "look at our line going up" decks will pause on this.

### Regime breakdown placeholder

A small subsection "Regime stratified results (full breakdown in v1.0)" — with placeholder text until Phase 3's research-grade backtest fills it in. Better to ship a placeholder than to delay the page.

---

## Step 5 — Polish pass on Ledger and Live

These don't get the heavy redesign — the Orb is the hero — but they need typography consistency.

### Ledger page

- Wrap all numbers in `<span className="font-display">` for serif, except column headers and labels.
- Replace the basic table rows with thin, generously-spaced rows (no zebra stripes, no borders between rows — just `--cs-stroke` between groups of 5 rows).
- BscScan links: muted, small underline only on hover. No external-link icon — judges who know what they're clicking.
- X402 payment proofs: render the first 8 + last 6 characters with a center ellipsis, copy button on hover.

### Live page (other than the Orb)

The Orb is the page. The only other elements:
- Top: a thin row with token symbol toggles (if monitoring multiple), wallet button on the right.
- Bottom: a one-line "ledger excerpt" — the last completed trade in a single line — that subtly fades in/out as new trades land.

That's it. Resist filling the page.

---

## Step 6 — Accessibility floor

This is a hackathon, not a production launch — but a judge using a screen reader should at minimum not hit a wall.

- All interactive elements have `aria-label` or visible text labels.
- The Orb has `aria-live="polite"` so screen readers announce major state changes (ignition, position open/close).
- Color is never the only signal — ignition is a visible scale animation *and* a color change; PnL state is the PnL number *and* the gradient.
- Keyboard: the wallet button and any modal are focusable; tab order is logical; escape closes modals.
- The motion-reduction preference is respected: `@media (prefers-reduced-motion: reduce) { /* shorten or disable pulse and ignition flash */ }`.

These are mostly free if you build with semantic HTML. Don't make them an afterthought.

---

## Step 7 — Mobile layout pass

Judges demo on laptops. But a screenshot of the dashboard on a phone in the writeup looks distinctive — it's worth ~30 minutes:

- Orb scales down to 280px. Stays centered.
- Sub-component bars stack into a vertical row.
- Wallet button moves to a fixed bottom-right pill.
- Backtest page: equity curve scales horizontally; metrics grid collapses to two columns then one.

Test on actual mobile (or DevTools mobile mode at 375px wide). Don't trust your eye at desktop zoom.

---

## Phase 2 exit checklist

- [ ] Type system locked in: Instrument Serif + JetBrains Mono + semantic CSS vars
- [ ] `CascadeOrb` built with all seven states (quiet, climbing, igniting, live, exit-TP, exit-SL, regime-blocked, stale)
- [ ] Ignition transition feels like a moment, not a tween (gut check: does it make you say "oh"?)
- [ ] Regime gate in `agent/src/decision/index.ts` AND `skill-server/cascade_skill.py`, with shared blocked-regime list
- [ ] `regimeGateBlocked` propagated to the DB snapshot and read by the Orb
- [ ] Committed backtest re-run with the regime gate, new `RESULTS.md` showing pre- vs post-gate
- [ ] `EquityCurve` SVG draws itself in on page load (1.5s animation)
- [ ] "Where it fails" honest-loss section on the backtest page
- [ ] Ledger and Live get the typography polish; numbers in serif, labels in mono
- [ ] Reduced-motion media query respected
- [ ] Mobile layout doesn't break at 375px
- [ ] Vercel redeployed; no console errors; lighthouse score reasonable (>80 on performance)
- [ ] Tag the merge: `git tag v0.99-distinct && git push --tags`

---

## What Phase 2 deliberately does not include

- CMC-native derivatives sourcing (Phase 3 — the data layer migration is a separate concern)
- Walk-forward backtest, full regime stratification (Phase 3 — research-grade upgrade)
- The installable CMC Skill folder (Phase 3 — the packaging move)
- Demo video, one-page PDF (Phase 3 — needs the finished submission to record against)
- Any new dashboard route (three routes only)
- Any UI component library (still banned)

The Orb is the make-or-break component. Get it right; the rest follows.
