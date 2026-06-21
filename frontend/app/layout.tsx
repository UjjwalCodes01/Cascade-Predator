import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Cascade Predator Dashboard",
  description: "Autonomous BNB DEX Liquidation Cascade strategy monitoring",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displaySerif.variable} ${dataMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0a0b0d] text-zinc-100 font-sans">
        <header className="border-b border-zinc-800 bg-[#0f1115] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-xl font-bold tracking-wider text-amber-500 font-mono">
              CASCADE PREDATOR
            </span>
            <nav className="flex gap-4">
              <Link href="/" className="text-sm font-medium hover:text-amber-400 text-zinc-300">
                Live
              </Link>
              <Link href="/ledger" className="text-sm font-medium hover:text-amber-400 text-zinc-300">
                Proof
              </Link>
              <Link href="/backtest" className="text-sm font-medium hover:text-amber-400 text-zinc-300">
                Edge
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1 flex flex-col p-6 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
