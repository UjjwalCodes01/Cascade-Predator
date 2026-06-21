export default function StrategyPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
          Strategy Guide
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" }}>
          How the Cascade Predator liquidation cascade detection strategy works
        </p>
      </div>

      {/* Hero Card */}
      <div
        style={{
          padding: "28px 32px",
          borderRadius: 14,
          background: "linear-gradient(135deg, #0052ff 0%, #7c3aed 100%)",
          color: "white",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -40,
            top: -40,
            width: 200,
            height: 200,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.05)",
          }}
        />
        <div style={{ position: "relative" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              opacity: 0.75,
              marginBottom: 10,
            }}
          >
            BNB Hack Track 2 · Strategy Skills
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 10, lineHeight: 1.2 }}>
            Liquidation Cascade Detection
          </div>
          <p style={{ opacity: 0.85, fontSize: 13, lineHeight: 1.7, maxWidth: 600, margin: 0 }}>
            When leveraged positions on BSC DEX markets get forcibly closed, they create a predictable
            price overshoot followed by a sharp snap-back. Cascade Predator detects this pattern in
            real-time using live CMC derivatives data, scores the probability, and confirms with Gemini AI.
          </p>
        </div>
      </div>

      {/* Signal Flow */}
      <div className="card" style={{ padding: "24px 28px" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Signal Pipeline</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            {
              step: "1",
              title: "Live Data Fetch",
              desc: "Fetches spot price from CMC REST API, market regime from CMC Agent Hub MCP (detect_market_regime skill), and derivatives data from Binance Futures (funding rate, open interest, taker ratios).",
              color: "#0052ff",
              icon: "📡",
            },
            {
              step: "2",
              title: "Cascade Score Computation",
              desc: "Three sub-signals are normalized and combined into a 0–100 composite score: Liquidation Intensity (40pts), Price Deviation (40pts), and Funding Rate Stress (20pts).",
              color: "#7c3aed",
              icon: "🧮",
            },
            {
              step: "3",
              title: "Regime Gate Check",
              desc: "If the CMC Agent Hub reports a trending_up, trending_strong_up, or euphoric regime, the strategy self-disables to avoid fighting the trend. No signal is emitted.",
              color: "#b45309",
              icon: "⏸",
            },
            {
              step: "4",
              title: "TWAK Security Scan",
              desc: "Trust Wallet Agent Kit (TWAK) scans the token's on-chain contract for honeypot patterns, critical risk flags, and contract vulnerabilities via HMAC-signed API calls.",
              color: "#00875a",
              icon: "🛡️",
            },
            {
              step: "5",
              title: "Gemini AI Confirmation",
              desc: "The full market snapshot is sent to Gemini 2.5 Flash for a second-pass filter. Only signals with ≥75% AI confidence are approved. Output: approved/rejected + reasoning.",
              color: "#d92d20",
              icon: "🤖",
            },
            {
              step: "6",
              title: "Signal Output",
              desc: "An approved signal returns: entry price, take-profit (+3%), stop-loss (−1.5%), time-stop (12 candles), position size (10% of capital), full cascade score breakdown.",
              color: "#0052ff",
              icon: "✅",
            },
          ].map((item, i, arr) => (
            <div key={item.step} style={{ display: "flex", gap: 20 }}>
              {/* Line + Circle */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: `${item.color}18`,
                    border: `2px solid ${item.color}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </div>
                {i < arr.length - 1 && (
                  <div
                    style={{
                      width: 2,
                      flex: 1,
                      minHeight: 24,
                      background: "linear-gradient(180deg, var(--border), transparent)",
                      margin: "4px 0",
                    }}
                  />
                )}
              </div>

              {/* Content */}
              <div style={{ paddingBottom: i < arr.length - 1 ? 24 : 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      background: item.color,
                      color: "white",
                      borderRadius: 20,
                      padding: "2px 8px",
                      letterSpacing: "0.04em",
                    }}
                  >
                    STEP {item.step}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{item.title}</span>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-soft)", margin: 0, lineHeight: 1.7 }}>
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="card" style={{ padding: "24px 28px" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Cascade Score Breakdown</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
          {[
            {
              title: "Liquidation Intensity",
              weight: "40 pts",
              formula: "clamp((liquidations / openInterest) / 0.005, 0, 1) × 40",
              desc: "Measures forced closures relative to total open interest. High score means heavy selling pressure from margin calls.",
              color: "#0052ff",
              trigger: "Score > 25 → Heavy forced selling in progress",
            },
            {
              title: "Price Deviation",
              weight: "40 pts",
              formula: "clamp(abs(price − avg_price) / avg_price / 0.05, 0, 1) × 40",
              desc: "Measures how far the current price has fallen below the rolling mean. Downward overshoots suggest snap-back potential.",
              color: "#7c3aed",
              trigger: "Score > 25 → Price far below mean, recovery expected",
            },
            {
              title: "Funding Rate Stress",
              weight: "20 pts",
              formula: "If rate < 0 → 20pts. If rate < 0.02% → proportional score",
              desc: "Negative funding rates mean longs pay shorts — indicating crowded short positioning and elevated squeeze risk.",
              color: "#b45309",
              trigger: "Score > 12 → Heavy shorting, squeeze risk elevated",
            },
          ].map((c) => (
            <div
              key={c.title}
              style={{
                padding: "18px 20px",
                border: `1px solid ${c.color}30`,
                borderRadius: 10,
                background: `${c.color}08`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{c.title}</span>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontWeight: 800,
                    color: c.color,
                    fontSize: 14,
                  }}
                >
                  {c.weight}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 10,
                  color: "var(--text-muted)",
                  background: "var(--bg)",
                  padding: "6px 10px",
                  borderRadius: 6,
                  marginBottom: 10,
                  lineHeight: 1.5,
                  border: "1px solid var(--border)",
                }}
              >
                {c.formula}
              </div>
              <p style={{ fontSize: 12, color: "var(--text-soft)", margin: "0 0 10px", lineHeight: 1.6 }}>
                {c.desc}
              </p>
              <div
                style={{
                  fontSize: 11,
                  color: c.color,
                  fontWeight: 600,
                  background: `${c.color}12`,
                  padding: "4px 10px",
                  borderRadius: 6,
                }}
              >
                ↑ {c.trigger}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Entry & Exit Logic */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Entry */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Entry Conditions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Cascade Score", rule: "≥ 70 / 100", color: "var(--accent)" },
              { label: "Fear & Greed Index", rule: "< 60 (not euphoric)", color: "var(--text)" },
              { label: "AI Confidence (Gemini)", rule: "≥ 75% approval", color: "var(--purple)" },
              { label: "Market Regime Gate", rule: "Not trending_up / euphoric", color: "var(--green)" },
              { label: "TWAK Security", rule: "No honeypot / critical risk", color: "var(--green)" },
            ].map((r) => (
              <div
                key={r.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: "var(--bg-soft)",
                  borderRadius: 8,
                  fontSize: 12,
                  alignItems: "center",
                }}
              >
                <span style={{ color: "var(--text-soft)" }}>{r.label}</span>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontWeight: 700,
                    color: r.color,
                  }}
                >
                  {r.rule}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Exit */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Exit Conditions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Take Profit", rule: "Entry × 1.03 (+3%)", color: "var(--green)" },
              { label: "Stop Loss", rule: "Entry × 0.985 (−1.5%)", color: "var(--red)" },
              { label: "Time Stop", rule: "After 12 candles (forced exit)", color: "var(--amber)" },
              { label: "Position Size", rule: "10% of capital per trade", color: "var(--text)" },
              { label: "Exit Priority", rule: "First trigger wins", color: "var(--text-muted)" },
            ].map((r) => (
              <div
                key={r.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: "var(--bg-soft)",
                  borderRadius: 8,
                  fontSize: 12,
                  alignItems: "center",
                }}
              >
                <span style={{ color: "var(--text-soft)" }}>{r.label}</span>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontWeight: 700,
                    color: r.color,
                  }}
                >
                  {r.rule}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tech Stack */}
      <div className="card-soft" style={{ padding: "22px 24px" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Technology Stack</div>
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}
        >
          {[
            {
              title: "CMC Agent Hub",
              desc: "detect_market_regime skill via MCP Streamable HTTP for real-time market regime context",
              icon: "🔮",
            },
            {
              title: "CoinMarketCap API",
              desc: "Spot prices, Fear & Greed index, and derivatives data (v2/v5 endpoints)",
              icon: "📊",
            },
            {
              title: "Binance Futures",
              desc: "Funding rate, open interest, global L/S ratio, taker buy/sell volume — public API",
              icon: "🏦",
            },
            {
              title: "Google Gemini 2.5",
              desc: "LLM signal confirmation with structured JSON output and ≥75% confidence gate",
              icon: "🤖",
            },
            {
              title: "Trust Wallet TWAK",
              desc: "HMAC-signed gateway API for honeypot detection and contract risk scanning",
              icon: "🛡️",
            },
            {
              title: "BNB AI Agent SDK",
              desc: "ERC-8004 identity + ERC-8183 commerce layer for on-chain skill registration",
              icon: "⛓️",
            },
          ].map((item) => (
            <div
              key={item.title}
              style={{
                padding: "14px 16px",
                background: "var(--bg)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 8 }}>{item.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
