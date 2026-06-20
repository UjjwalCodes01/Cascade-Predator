"""
cascade_skill.py — Core strategy logic for the Cascade Predator CMC Skill.

This module fetches live data from the CoinMarketCap AI Agent Hub and Binance Futures API,
computes a composite cascade probability score, runs security checks via Trust Wallet Agent Kit (TWAK),
and confirms high-confidence setups with Gemini.
"""

from __future__ import annotations

import os
import time
import json
import re
import hmac
import hashlib
import base64
import httpx
import asyncio
import subprocess
from uuid import uuid4
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional
from google import genai
from google.genai import types as genai_types

from tokens import get_token_info, get_token_address

# ── Configuration (read from env, same as TypeScript agent) ──────────────────

CMC_API_KEY         = os.environ.get("CMC_API_KEY", "")
GEMINI_API_KEY      = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL        = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
CASCADE_THRESHOLD   = float(os.environ.get("CASCADE_SCORE_THRESHOLD", "70"))
TAKE_PROFIT_PCT     = float(os.environ.get("TAKE_PROFIT_PCT", "3.0"))
STOP_LOSS_PCT       = float(os.environ.get("STOP_LOSS_PCT", "1.5"))
TRADE_SIZE_PCT      = float(os.environ.get("TRADE_SIZE_PCT", "10"))
EXIT_TIMEOUT        = int(os.environ.get("EXIT_TIMEOUT_CANDLES", "12"))

USE_VERTEX_AI       = os.environ.get("USE_VERTEX_AI", "false").lower() == "true"
GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
GOOGLE_CLOUD_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")

CMC_BASE = "https://pro-api.coinmarketcap.com"
CMC_HEADERS = {
    "X-CMC_PRO_API_KEY": CMC_API_KEY,
    "Accept": "application/json",
}

# Binance Futures base
BINANCE_FAPI = "https://fapi.binance.com"

# ── Data models ──────────────────────────────────────────────────────────────

@dataclass
class MarketSnapshot:
    token: str
    fundingRate: float         # in decimal, e.g. 0.0001 = 0.01%
    openInterest: float        # in USD
    liquidations: float        # estimated 1h liquidation volume in USD
    price: float               # spot price in USD
    fearGreed: int             # 0–100
    timestamp: int             # timestamp in ms
    longShortRatio: float      # ratio of long / short accounts
    takerBuySellRatio: float   # ratio of taker buy / sell volume
    mcpReport: Optional[dict] = None


@dataclass
class SignalComponents:
    liquidationIntensity: float   # 0–40
    priceDeviation: float         # 0–40
    fundingStress: float          # 0–20


@dataclass
class CascadeSignal:
    token: str
    cascadeScore: float         # 0–100
    components: SignalComponents
    approved: bool
    confidence: int             # 0–100
    reasoning: str
    entry: float
    take_profit: float
    stop_loss: float
    size_pct: float
    time_stop_candles: int
    market: MarketSnapshot
    timestamp: str


# ── Binance Futures Fetcher ───────────────────────────────────────────────────

async def fetch_futures_data(futures_pair: str, spot_price: float) -> dict:
    """
    Fetches real open interest, funding rate, and taker ratios from Binance Futures.
    Mirrors fetchFuturesData in agent/src/data/index.ts exactly.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            premium_url = f"{BINANCE_FAPI}/fapi/v1/premiumIndex?symbol={futures_pair}"
            oi_url = f"{BINANCE_FAPI}/fapi/v1/openInterest?symbol={futures_pair}"
            ls_ratio_url = f"{BINANCE_FAPI}/futures/data/globalLongShortAccountRatio?symbol={futures_pair}&period=5m&limit=1"
            taker_url = f"{BINANCE_FAPI}/futures/data/takerlongshortRatio?symbol={futures_pair}&period=5m&limit=3"

            responses = await asyncio.gather(
                client.get(premium_url),
                client.get(oi_url),
                client.get(ls_ratio_url),
                client.get(taker_url),
                return_exceptions=True
            )

            # Check for failures
            for idx, r in enumerate(responses):
                if isinstance(r, Exception):
                    raise r
                r.raise_for_status()

            premium = responses[0].json()
            oi = responses[1].json()
            ls_ratio_list = responses[2].json()
            taker_ratios = responses[3].json()

            funding_rate = float(premium.get("lastFundingRate", 0.0001))
            open_interest = float(oi.get("openInterest", 0.0)) * spot_price

            long_short_ratio = 1.0
            if ls_ratio_list and len(ls_ratio_list) > 0:
                long_short_ratio = float(ls_ratio_list[0].get("longShortRatio", 1.0))

            taker_buy_sell_ratio = 1.0
            if taker_ratios:
                avg_taker = sum(float(r.get("buySellRatio", 1.0)) for r in taker_ratios) / len(taker_ratios)
                taker_buy_sell_ratio = avg_taker

            # Derive liquidation proxy: excess sell volume
            latest_taker = taker_ratios[-1] if taker_ratios else {}
            raw_sell_vol = float(latest_taker.get("sellVol", 0.0))
            raw_buy_vol = float(latest_taker.get("buyVol", 0.0))
            sell_excess = max(0.0, raw_sell_vol - raw_buy_vol)
            liquidations = sell_excess * spot_price

            return {
                "fundingRate": funding_rate,
                "openInterest": open_interest,
                "liquidations": liquidations,
                "longShortRatio": long_short_ratio,
                "takerBuySellRatio": taker_buy_sell_ratio
            }
    except Exception as err:
        print(f"[data] Binance futures API failed for {futures_pair}: {err}")
        return {
            "fundingRate": 0.0001,
            "openInterest": 0.0,
            "liquidations": 0.0,
            "longShortRatio": 1.0,
            "takerBuySellRatio": 1.0
        }


# ── CMC Data Fetcher ──────────────────────────────────────────────────────────

async def fetch_market_regime_from_mcp() -> dict:
    """
    Executes the detect_market_regime skill via CoinMarketCap Agent Hub (MCP) Streamable HTTP POST.
    """
    if not CMC_API_KEY:
        raise ValueError("CMC_API_KEY is not set in environment.")

    url = "https://mcp.coinmarketcap.com/skill-hub/stream"
    headers = {
        "X-CMC-MCP-API-KEY": CMC_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "execute_skill",
            "arguments": {
                "unique_name": "detect_market_regime",
                "parameters": {
                    "time_window": "30d"
                }
            }
        },
        "id": 100
    }

    print("[mcp] Calling CMC Agent Hub detect_market_regime skill...")
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        
        # Parse SSE message line-by-line
        text = resp.text
        for line in text.splitlines():
            if line.startswith("data:"):
                data_json = line[5:].strip()
                rpc_response = json.loads(data_json)
                
                # Check for json-rpc errors
                if "error" in rpc_response:
                    raise RuntimeError(f"MCP RPC Error: {rpc_response['error']}")
                
                # Extract the result text
                result_content = rpc_response.get("result", {}).get("content", [])
                if not result_content:
                    raise RuntimeError("MCP response content is empty")
                
                raw_text = result_content[0].get("text", "")
                if not raw_text:
                    raise RuntimeError("MCP content text is empty")
                
                # Parse the nested JSON output
                outer_result = json.loads(raw_text)
                
                # Check for execution error
                rpc_inner_res = outer_result.get("result", {})
                if rpc_inner_res.get("error"):
                    raise RuntimeError(f"MCP inner execution failed: {rpc_inner_res.get('error')}")
                
                output_str = rpc_inner_res.get("output", "")
                if not output_str:
                    raise RuntimeError("MCP output is empty")
                    
                skill_result = json.loads(output_str)
                evidence_data = skill_result.get("result", {}).get("data", {})
                
                status = evidence_data.get("status", "error")
                if status != "ok":
                    raise RuntimeError(f"MCP skill returned non-ok status: {status}")
                
                report = evidence_data.get("report", {})
                metrics = report.get("metrics", {})
                
                return {
                    "fear_greed_value": int(metrics.get("fear_greed_value", 50)),
                    "market_regime": report.get("market_regime", "unknown"),
                    "conviction": report.get("conviction", "unknown"),
                    "leverage_state": report.get("leverage_state", "unknown"),
                    "liquidation_state": report.get("liquidation_state", "unknown"),
                    "summary": evidence_data.get("summary", ""),
                    "action_guidance": evidence_data.get("action_guidance", {}),
                    "raw_report": report
                }
                
        raise RuntimeError("No event:message data found in MCP stream response")


async def fetch_market_snapshot(token: str) -> MarketSnapshot:
    """
    Fetch live spot price + Fear & Greed index from CMC (using MCP or fallback REST), and derivatives from Binance.
    """
    token_info = get_token_info(token)

    # 1. Try to fetch from CoinMarketCap Agent Hub (MCP) first
    fear_greed = 50
    mcp_report = None
    try:
        mcp_data = await fetch_market_regime_from_mcp()
        fear_greed = mcp_data["fear_greed_value"]
        mcp_report = mcp_data
        print(f"[mcp] Successfully fetched Fear & Greed ({fear_greed}) and Regime ({mcp_data['market_regime']}) from CMC Agent Hub.")
    except Exception as e:
        print(f"[mcp] CMC Agent Hub call failed: {e}. Falling back to REST API.")
        
    async with httpx.AsyncClient(timeout=10.0) as client:
        # 2. Spot price, volume, pctChange1h
        quote_resp = await client.get(
            f"{CMC_BASE}/v2/cryptocurrency/quotes/latest",
            headers=CMC_HEADERS,
            params={"symbol": token_info["cmcSymbol"], "convert": "USD"},
        )
        quote_resp.raise_for_status()
        raw = quote_resp.json()["data"][token_info["cmcSymbol"]]
        entry = raw[0] if isinstance(raw, list) else raw
        quote_data = entry["quote"]["USD"]

        price = float(quote_data["price"])
        volume_24h = float(quote_data.get("volume_24h", 0.0))
        percent_change_1h = float(quote_data.get("percent_change_1h", 0.0))

        # 3. Fallback Fear & Greed if MCP failed
        if mcp_report is None:
            try:
                fg_resp = await client.get(
                    f"{CMC_BASE}/v3/fear-and-greed/latest",
                    headers=CMC_HEADERS
                )
                if fg_resp.status_code == 200:
                    fg_data = fg_resp.json().get("data", {})
                    fear_greed = int(fg_data.get("value", 50))
            except Exception as e:
                print(f"[data] Failed to fetch CMC Fear & Greed fallback: {e}")

    # 4. Derivatives via Binance
    derivs = {
        "fundingRate": 0.0001,
        "openInterest": 0.0,
        "liquidations": 0.0,
        "longShortRatio": 1.0,
        "takerBuySellRatio": 1.0
    }
    if token_info["futuresPair"]:
        derivs = await fetch_futures_data(token_info["futuresPair"], price)

    return MarketSnapshot(
        token=token,
        fundingRate=derivs["fundingRate"],
        openInterest=derivs["openInterest"],
        liquidations=derivs["liquidations"],
        price=price,
        fearGreed=fear_greed,
        timestamp=int(time.time() * 1000),
        longShortRatio=derivs["longShortRatio"],
        takerBuySellRatio=derivs["takerBuySellRatio"],
        mcpReport=mcp_report
    )


# ── TWAK Token Risk Assessor (Direct HMAC API) ────────────────────────────────

TWAK_GATEWAY_URL = "https://tws.trustwallet.com"
TWAK_ACCESS_ID   = os.environ.get("TWAK_ACCESS_ID", "")
TWAK_HMAC_SECRET = os.environ.get("TWAK_HMAC_SECRET", "")


def _twak_sign_request(method: str, path: str, query: str = "") -> dict:
    """
    Generates TWAK HMAC-SHA256 signed request headers.
    Replicates the exact signing logic from the TWAK CLI source (signRequest fn).

    Plaintext = METHOD;PATH;SORTED_QUERY;ACCESS_ID;NONCE;DATE
    Signature = HMAC-SHA256(plaintext, HMAC_SECRET) → base64
    """
    date = datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")
    nonce = str(uuid4())

    # Sort query params alphabetically (mirrors sortQueryRaw in CLI)
    sorted_query = "&".join(sorted(query.lstrip("?").split("&"))) if query else ""

    plaintext = ";".join([
        method.upper(),
        path,
        sorted_query,
        TWAK_ACCESS_ID,
        nonce,
        date,
    ])

    signature = base64.b64encode(
        hmac.new(TWAK_HMAC_SECRET.encode(), plaintext.encode(), hashlib.sha256).digest()
    ).decode()

    return {
        "X-TW-CREDENTIAL": TWAK_ACCESS_ID,
        "X-TW-NONCE": nonce,
        "X-TW-DATE": date,
        "Authorization": f"HMAC-SHA256 Signature={signature}",
        "Content-Type": "application/json",
        "User-Agent": "twak/0.19.1",
    }


def check_token_risk_with_twak(token: str) -> dict:
    """
    Checks token risk by calling the TWAK Gateway API directly using HMAC-SHA256
    signed requests — the same backend called by 'twak risk bsc:{address} --json'.

    Endpoint: GET https://tws.trustwallet.com/v2/coinstatus/{asset_id}
    Auth: TWAK_ACCESS_ID + TWAK_HMAC_SECRET env vars (from skill-server/.env)

    Falls back gracefully if credentials are missing or the API is unreachable.
    """
    from pathlib import Path

    # 1. Check credentials are available
    if not TWAK_ACCESS_ID or not TWAK_HMAC_SECRET:
        print("[twak-risk] TWAK_ACCESS_ID / TWAK_HMAC_SECRET not set. Skipping risk check.")
        return {"success": True, "source": "fallback", "safe": True, "reason": "No TWAK credentials"}

    # 2. Resolve on-chain address for this token
    address = None
    allowlist_path = Path(__file__).parent.parent / "config" / "token-allowlist.json"
    if allowlist_path.exists():
        try:
            with open(allowlist_path, "r") as f:
                allowlist = json.load(f)
                address = allowlist.get(token.upper())
        except Exception as e:
            print(f"[twak-risk] Failed to read allowlist: {e}")

    if not address:
        try:
            address = get_token_address(token)
        except Exception:
            pass

    if not address:
        print(f"[twak-risk] No on-chain address for {token}. Skipping risk check.")
        return {"success": True, "source": "fallback", "safe": True, "reason": "No address found"}

    # 3. Build the asset ID: "c20000714_t{address}"
    # BSC testnet chain coin = c20000714, BSC mainnet = c20000714 (same coin, different network)
    asset_id = f"c20000714_t{address.lower()}"
    path = f"/v2/coinstatus/{asset_id}"
    query_str = "version=8.4&platform=android&include_security_info=true&include_solana_security_info=true"
    query_sorted = "&".join(sorted(query_str.split("&")))

    print(f"[twak-risk] Calling TWAK Gateway API for {token} ({address})...")

    try:
        headers = _twak_sign_request("GET", path, query_sorted)
        url = f"{TWAK_GATEWAY_URL}{path}?{query_sorted}"

        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, headers=headers)

        if resp.status_code == 404:
            # Token not indexed — treat as safe (native/wrapped assets)
            print(f"[twak-risk] Token {token} not found in TWAK index — treating as safe.")
            return {"success": True, "source": "twak", "safe": True, "reason": "Token not indexed (native asset)"}

        if resp.status_code != 200:
            print(f"[twak-risk] TWAK API returned {resp.status_code}. Falling back.")
            return {"success": True, "source": "fallback", "safe": True, "reason": f"HTTP {resp.status_code}"}

        data = resp.json()

        # 4. Parse security info from the coinstatus response
        security = data.get("security", {})
        contract_sec = security.get("contract_security", {})
        honeypot_risk = security.get("honeypot_risk", {})

        # Detect honeypot: any item with code="is_honeypot" and type="risk"
        is_honeypot = any(
            item.get("code") == "is_honeypot" and item.get("type") == "risk"
            for item in honeypot_risk.get("items", [])
        )

        # Aggregate risk counts
        num_risks    = (contract_sec.get("num_risks", 0) or 0) + (honeypot_risk.get("num_risks", 0) or 0)
        num_warnings = (contract_sec.get("num_warnings", 0) or 0) + (honeypot_risk.get("num_warnings", 0) or 0)
        risk_level   = security.get("risk_level") or security.get("riskLevel") or "unknown"

        print(
            f"[twak-risk] {token}: honeypot={is_honeypot}, "
            f"risks={num_risks}, warnings={num_warnings}, level={risk_level}"
        )

        # Reject high-risk tokens
        if is_honeypot or risk_level in ("high", "critical") or num_risks >= 3:
            reason = (
                f"TWAK detected high risk: honeypot={is_honeypot}, "
                f"risks={num_risks}, warnings={num_warnings}, level={risk_level}"
            )
            print(f"[twak-risk] ⚠️  BLOCKED — {reason}")
            return {
                "success": True,
                "source": "twak",
                "safe": False,
                "reason": reason,
                "details": {
                    "isHoneypot": is_honeypot,
                    "numRisks": num_risks,
                    "numWarnings": num_warnings,
                    "riskLevel": risk_level,
                },
            }

        return {
            "success": True,
            "source": "twak",
            "safe": True,
            "details": {
                "isHoneypot": is_honeypot,
                "numRisks": num_risks,
                "numWarnings": num_warnings,
                "riskLevel": risk_level,
            },
        }

    except Exception as exc:
        print(f"[twak-risk] Graceful fallback — API call failed: {exc}")
        return {"success": True, "source": "fallback", "safe": True, "reason": f"Exception: {exc}"}


# ── Signal Core (pure function — mirrors signal/index.ts exactly) ─────────────

def compute_cascade_score(
    snapshot: MarketSnapshot,
    price_history: list[float],
) -> tuple[float, SignalComponents]:
    """
    Pure function: same algorithm as agent/src/signal/index.ts.
    Returns (cascadeScore, components).
    """

    # Default components to 0
    liquidation_score = 0.0
    price_deviation_score = 0.0
    funding_stress_score = 0.0

    # 1. Calculate Liquidation Intensity (Cap: 40 points)
    if snapshot.openInterest > 0:
        liq_ratio = snapshot.liquidations / snapshot.openInterest
        # E.g., ratio of 0.005 (0.5% of open interest liquidated) represents high stress.
        liquidation_score = min((liq_ratio / 0.005) * 40, 40)

    # 2. Calculate Price Deviation / Overshoot (Cap: 40 points)
    if price_history:
        avg_price = sum(price_history) / len(price_history)
        if avg_price > 0:
            deviation = (snapshot.price - avg_price) / avg_price
            if deviation < 0:
                abs_dev = abs(deviation)
                price_deviation_score = min((abs_dev / 0.05) * 40, 40)

    # 3. Calculate Funding Stress (Cap: 20 points)
    if snapshot.fundingRate < 0:
        funding_stress_score = 20
    elif snapshot.fundingRate < 0.0002:
        funding_stress_score = max((0.0002 - snapshot.fundingRate) / 0.0002 * 20, 0)

    cascade_score = liquidation_score + price_deviation_score + funding_stress_score
    cascade_score = min(cascade_score, 100)

    components = SignalComponents(
        liquidationIntensity=round(liquidation_score, 2),
        priceDeviation=round(price_deviation_score, 2),
        fundingStress=round(funding_stress_score, 2),
    )

    return round(cascade_score, 2), components


# ── LLM Confirmation (mirrors decision/index.ts) ──────────────────────────────

SYSTEM_PROMPT = """You are a quantitative trading AI specializing in short-term liquidation cascade events on BNB Smart Chain DEX markets.

Your sole task is to evaluate whether the provided technical indicators justify a LONG signal to capture a liquidation cascade snap-back.

A liquidation cascade occurs when large leveraged positions are forcefully closed, causing a rapid price drop followed by a sharp recovery as buying pressure absorbs the forced selling.

## Your output MUST be a single valid JSON object with exactly these fields:
{
  "approved": boolean,
  "confidence": number (0-100),
  "reasoning": "one concise sentence"
}

## Rules
- Approve ONLY if you are confident this is a genuine short-term cascade snap-back opportunity.
- Do NOT approve if cascadeScore < 40.
- Do NOT approve if fearGreed >= 60 (euphoric market, not a panic bottom).
- Confidence above 75 is required to approve.
- Output ONLY the JSON object. No markdown. No explanation outside the JSON."""


async def consult_gemini(
    snapshot: MarketSnapshot,
    cascade_score: float,
    components: SignalComponents,
) -> tuple[bool, int, str]:
    """
    Call Gemini to confirm the signal. Returns (approved, confidence, reasoning).
    Falls back to (threshold_check, 0, reason) if call fails.
    """
    use_vertex = USE_VERTEX_AI or not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here"
    
    if not use_vertex and (not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here"):
        approved = cascade_score >= CASCADE_THRESHOLD
        return approved, 0, "No Gemini API key — threshold-only mode"

    user_message = f"""
## Market Signal for {snapshot.token}

**Cascade Score:** {cascade_score}/100 (threshold: {CASCADE_THRESHOLD})

### Signal Components
- Liquidation Intensity Score: {components.liquidationIntensity}/40
- Price Deviation Score: {components.priceDeviation}/40
- Funding Stress Score: {components.fundingStress}/20

### Live Market Data
- Current Price: ${snapshot.price:.4f}
- Open Interest (estimated): ${snapshot.openInterest/1_000_000:.2f}M
- Funding Rate: {snapshot.fundingRate * 100:.4f}%
- Fear & Greed: {snapshot.fearGreed}
"""

    if snapshot.mcpReport:
        user_message += f"""
### CoinMarketCap Agent Hub Market Regime Insights
- Market Regime: {snapshot.mcpReport.get('market_regime')}
- Conviction: {snapshot.mcpReport.get('conviction')}
- Leverage State: {snapshot.mcpReport.get('leverage_state')}
- Liquidation State: {snapshot.mcpReport.get('liquidation_state')}
- Summary: {snapshot.mcpReport.get('summary')}
- Action Guidance: {snapshot.mcpReport.get('action_guidance', {}).get('next_step')}
"""

    user_message += f"""
### Risk Parameters
- Take Profit: +{TAKE_PROFIT_PCT}%
- Stop Loss: -{STOP_LOSS_PCT}%
- Position Size: {TRADE_SIZE_PCT}% of capital

Should I generate a LONG entry signal?""".strip()

    try:
        if use_vertex:
            client = genai.Client(
                vertexai=True,
                project=GOOGLE_CLOUD_PROJECT or None,
                location=GOOGLE_CLOUD_LOCATION or None
            )
        else:
            client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[{"role": "user", "parts": [{"text": user_message}]}],
            config=genai_types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.1,
                max_output_tokens=256,
                response_mime_type="application/json",
            ),
        )
        raw = (response.text or "").strip()
        raw = re.sub(r"^```json\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        decision = json.loads(raw)

        approved = bool(decision.get("approved", False))
        confidence = int(decision.get("confidence", 0))
        reasoning = str(decision.get("reasoning", ""))

        if confidence < 75:
            approved = False

        return approved, confidence, reasoning

    except Exception as exc:
        approved = cascade_score >= CASCADE_THRESHOLD
        return approved, 0, f"Gemini unavailable ({exc}), threshold fallback"


# ── Main Entry Point ──────────────────────────────────────────────────────────

_price_history: dict[str, list[float]] = {}


async def analyze_token(token: str) -> dict:
    """
    Full pipeline: fetch → score → risk check → confirm → return structured signal.
    """
    token = token.upper().strip()

    # 1. Fetch live market snapshot from CMC & Binance
    try:
        snapshot = await fetch_market_snapshot(token)
    except Exception as exc:
        return {
            "signal": None,
            "cascadeScore": 0,
            "confidence": 0,
            "reason": f"Market data fetch failed: {exc}",
        }

    # 2. Update rolling price history (in-memory, resets on server restart)
    if token not in _price_history:
        _price_history[token] = []
    _price_history[token].append(snapshot.price)
    if len(_price_history[token]) > 20: # Match TS window size of 20
        _price_history[token] = _price_history[token][-20:]

    # 3. Compute cascade score (pure function)
    cascade_score, components = compute_cascade_score(snapshot, _price_history[token])

    # 4. Pre-filter: don't call LLM for weak signals (saves API cost)
    if cascade_score < 40:
        return {
            "signal": None,
            "cascadeScore": cascade_score,
            "components": asdict(components),
            "confidence": 0,
            "reason": f"cascadeScore {cascade_score} below pre-filter threshold 40",
        }

    # 5. TWAK Risk Assessment (L2 Security Check)
    risk_result = check_token_risk_with_twak(token)
    if risk_result.get("safe") is False:
        return {
            "signal": None,
            "cascadeScore": cascade_score,
            "components": asdict(components),
            "confidence": 0,
            "reason": risk_result["reason"],
            "market": asdict(snapshot),
        }

    # 6. LLM confirmation
    approved, confidence, reasoning = await consult_gemini(snapshot, cascade_score, components)

    # 7. Build output
    if not approved:
        return {
            "signal": None,
            "cascadeScore": cascade_score,
            "components": asdict(components),
            "confidence": confidence,
            "reason": reasoning,
            "market": asdict(snapshot),
        }

    # 8. Approved — build full signal
    tp_price = round(snapshot.price * (1 + TAKE_PROFIT_PCT / 100), 6)
    sl_price = round(snapshot.price * (1 - STOP_LOSS_PCT / 100), 6)
    now = datetime.now(timezone.utc).isoformat()

    signal = CascadeSignal(
        token=token,
        cascadeScore=cascade_score,
        components=components,
        approved=True,
        confidence=confidence,
        reasoning=reasoning,
        entry=snapshot.price,
        take_profit=tp_price,
        stop_loss=sl_price,
        size_pct=TRADE_SIZE_PCT,
        time_stop_candles=EXIT_TIMEOUT,
        market=snapshot,
        timestamp=now,
    )

    return {
        "signal": asdict(signal),
        "cascadeScore": cascade_score,
        "components": asdict(components),
        "confidence": confidence,
        "reasoning": reasoning,
        "market": asdict(snapshot),
    }
