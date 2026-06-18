"""
tokens.py — Token registry mapping for the Python skill server.
Mirrors agent/src/tokens/index.ts exactly.
"""

TOKEN_REGISTRY = {
    "WBNB": {
        "address": "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
        "futuresPair": "BNBUSDT",
        "cmcSymbol": "BNB",
    },
    "CAKE": {
        "address": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
        "futuresPair": "CAKEUSDT",
        "cmcSymbol": "CAKE",
    },
    "ETH": {
        "address": "0xd66c6b4f0be8ce5b39d52e0fd1344c389929b378",
        "futuresPair": "ETHUSDT",
        "cmcSymbol": "ETH",
    },
    "BTC": {
        "address": "0x6ce8da28e2f864420840cf74474eff5fd80e65b8",
        "futuresPair": "BTCUSDT",
        "cmcSymbol": "BTC",
    },
    "USDT": {
        "address": "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd",
        "futuresPair": None,
        "cmcSymbol": "USDT",
    },
}

def get_token_info(symbol: str) -> dict:
    sym = symbol.upper().strip()
    if sym not in TOKEN_REGISTRY:
        raise ValueError(
            f"Token '{symbol}' is not in the registry. "
            f"Available: {', '.join(TOKEN_REGISTRY.keys())}"
        )
    return TOKEN_REGISTRY[sym]

def get_token_address(symbol: str) -> str:
    return get_token_info(symbol)["address"]
