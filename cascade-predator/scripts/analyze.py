#!/usr/bin/env python3
"""
analyze.py — Standalone entrypoint script for the Cascade Predator CMC Skill.
Performs cascade analysis on a token by importing the strategy server functions.
"""

import sys
import os
import asyncio
import json

# Add parent directories to sys.path to allow imports from root-level folders
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

# Ensure env vars are loaded from root or skill-server directory
from dotenv import load_dotenv
load_dotenv(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../.env')))
load_dotenv(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../skill-server/.env')))

# Add skill-server folder to sys.path to resolve tokens/price_history imports inside cascade_skill
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../skill-server')))

from cascade_skill import analyze_token

async def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze.py <TOKEN>")
        sys.exit(1)
        
    token = sys.argv[1]
    print(f"[skill-cli] Running cascade predator analysis for {token}...")
    
    result = await analyze_token(token)
    print(json.dumps(result, indent=2, default=str))

if __name__ == "__main__":
    asyncio.run(main())
