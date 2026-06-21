import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cascade Predator — BNB Liquidation Cascade Strategy",
  description: "Autonomous liquidation cascade detection and signal generation on BNB Smart Chain DEX markets.",
};

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/scanner", label: "Scanner" },
  { href: "/positions", label: "Positions" },
  { href: "/backtest", label: "Backtest" },
  { href: "/ledger", label: "Ledger" },
  { href: "/strategy", label: "Strategy" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col" style={{ background: "var(--bg)", color: "var(--text)" }}>
        {/* Top Navigation */}
        <header
          style={{
            background: "var(--bg)",
            borderBottom: "1px solid var(--border)",
            position: "sticky",
            top: 0,
            zIndex: 50,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              maxWidth: 1280,
              margin: "0 auto",
              padding: "0 24px",
              height: 60,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
            }}
          >
            {/* Logo */}
            <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "linear-gradient(135deg, #0052ff 0%, #7c3aed 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2L14 13H2L8 2Z" fill="white" fillOpacity={0.9} />
                  <circle cx="8" cy="10" r="2" fill="white" fillOpacity={0.5} />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
                  Cascade Predator
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, letterSpacing: "0.03em", lineHeight: 1 }}>
                  BNB LIQUIDATION HUNTER
                </div>
              </div>
            </Link>

            {/* Nav Links */}
            <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="nav-link">
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Status Pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                background: "var(--green-bg)",
                border: "1px solid #bbf7d0",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--green)",
              }}
            >
              <span className="live-dot" />
              BSC Testnet
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main style={{ flex: 1, maxWidth: 1280, width: "100%", margin: "0 auto", padding: "32px 24px" }}>
          {children}
        </main>

        {/* Footer */}
        <footer
          style={{
            borderTop: "1px solid var(--border)",
            padding: "20px 24px",
            textAlign: "center",
            fontSize: 12,
            color: "var(--text-muted)",
            background: "var(--bg-soft)",
          }}
        >
          Cascade Predator · BNB Hack Track 2 — Strategy Skills · CMC Agent Hub + Gemini + TWAK · BSC Testnet
        </footer>
      </body>
    </html>
  );
}
