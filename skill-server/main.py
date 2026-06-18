"""
main.py — Cascade Predator ERC-8183 Skill Server

An ERC-8183 provider that accepts "cascade signal analysis" jobs,
fetches live CMC derivatives data, runs the cascade probability scorer,
confirms with Gemini, and returns a structured JSON signal as the deliverable.

The agent identity is registered on-chain via ERC-8004 (gas-free on BSC Testnet).

Start:
    uvicorn main:app --port 8003

Register identity first:
    python register.py
"""

import os
import re
import json
from dotenv import load_dotenv
from typing import Optional

load_dotenv()

from bnbagent.erc8183.server import create_erc8183_app
from cascade_skill import analyze_token

# ── Job Handler ──────────────────────────────────────────────────────────────

MONITORED_TOKENS = [
    t.strip().upper()
    for t in os.environ.get("MONITORED_TOKENS", "WBNB,CAKE,FLOKI,TWT,PENDLE").split(",")
    if t.strip()
]


async def on_job(job: dict) -> tuple[str, dict]:
    """
    ERC-8183 job handler — called automatically for each FUNDED job.

    The job description should specify the token to analyze, e.g.:
      "Analyze CAKE for liquidation cascade entry signal"
      "cascade signal WBNB"
      "FLOKI"

    Returns: (deliverable_string, metadata_dict)
    """
    description = job.get("description", "")
    job_id = job.get("jobId", "unknown")

    print(f"[job:{job_id}] Received: {description!r}")

    # Parse token from description
    token = _parse_token(description)
    if token is None:
        result = {
            "error": "Could not parse token from job description.",
            "hint": "Include the token symbol in the description, e.g. 'Analyze CAKE for cascade signal'",
            "supported_tokens": MONITORED_TOKENS,
        }
        return json.dumps(result), {"status": "error", "reason": "unparseable_token"}

    print(f"[job:{job_id}] Analyzing token: {token}")

    # Run the full cascade analysis pipeline
    result = await analyze_token(token)

    approved = result.get("signal") is not None
    score = result.get("cascadeScore", 0)
    confidence = result.get("confidence", 0)

    print(
        f"[job:{job_id}] Done — score={score}, approved={approved}, confidence={confidence}"
    )

    metadata = {
        "token": token,
        "cascadeScore": score,
        "approved": approved,
        "confidence": confidence,
    }

    return json.dumps(result, default=str), metadata


def _parse_token(description: str) -> str | None:
    """
    Extract a token symbol from a free-text job description.
    Tries several patterns before giving up.
    """
    desc = description.upper().strip()

    # 1. Explicit "analyze {TOKEN}" pattern
    m = re.search(r"ANALYZ[EI]*\s+([A-Z0-9]{2,10})", desc)
    if m:
        return m.group(1)

    # 2. "signal {TOKEN}" or "cascade {TOKEN}"
    m = re.search(r"(?:SIGNAL|CASCADE|SCAN|CHECK)\s+([A-Z0-9]{2,10})", desc)
    if m:
        return m.group(1)

    # 3. Token is the entire description (e.g. "CAKE" or "WBNB")
    clean = re.sub(r"[^A-Z0-9]", "", desc)
    if 2 <= len(clean) <= 10:
        return clean

    # 4. First word that looks like a ticker
    words = re.findall(r"[A-Z0-9]{2,10}", desc)
    for word in words:
        if word in MONITORED_TOKENS:
            return word

    return words[0] if words else None


# ── App ───────────────────────────────────────────────────────────────────────

app = create_erc8183_app(on_job=on_job)


# ── Health / Info / x402 Extensions ───────────────────────────────────────────

from fastapi import APIRouter, Header, HTTPException

extra = APIRouter()


@extra.get("/skill/info")
def skill_info():
    """Human-readable skill metadata for judges and integrators."""
    return {
        "name": "cascade-predator",
        "version": "1.0.0",
        "description": (
            "Detects liquidation cascade setups on BSC DEX markets using "
            "CoinMarketCap derivatives data. Returns a structured LONG entry "
            "signal with take-profit, stop-loss, and LLM confidence score."
        ),
        "track": "BNB Hack Track 2 — Strategy Skills",
        "data_provider": "CoinMarketCap AI Agent Hub + Binance Futures API",
        "twak_integration": "TWAK CLI Token Risk Check (Standard L2 Safety)",
        "x402_gating": "Exposes optional x402 signature verification endpoint",
        "monitored_tokens": MONITORED_TOKENS,
        "input_example": {
            "description": "Analyze CAKE for liquidation cascade entry signal"
        },
        "output_schema": "See SKILL.md in the repository root",
    }


@extra.get("/skill/scan/{token}")
async def quick_scan(
    token: str,
    x_payment_signature: Optional[str] = Header(None, alias="X-Payment-Signature"),
    x_payment_nonce: Optional[str] = Header(None, alias="X-Payment-Nonce"),
):
    """
    Quick one-shot scan for a token.
    Supports optional x402 signature verification to showcase Track 2 payment gating.
    """
    token = token.upper().strip()

    # Verify x402 proof if headers are present
    if x_payment_signature and x_payment_nonce:
        try:
            from eth_account.messages import encode_defunct
            from eth_account import Account

            # Reconstruct exact message format signed by the client
            cost = "0.0001"
            resource = f"cmc/derivatives/{token}"
            message_text = f"x402:pay:{resource}:{cost}:{x_payment_nonce}"

            message = encode_defunct(text=message_text)
            recovered = Account.recover_message(message, signature=x_payment_signature)

            print(f"[x402-server] ✅ Verified payment proof from client: {recovered}")
            print(f"  Resource: {resource}")
            print(f"  Cost: {cost} U")
            print(f"  Nonce: {x_payment_nonce}")

        except Exception as e:
            print(f"[x402-server] ❌ Signature verification failed: {e}")
            raise HTTPException(
                status_code=400,
                detail=f"Invalid x402 payment proof: {e}"
            )

    return await analyze_token(token)


app.include_router(extra)
