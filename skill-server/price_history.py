import sqlite3
from pathlib import Path

_DB_PATH = Path(__file__).parent / ".agent-data" / "price_history.sqlite"
_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.execute("""CREATE TABLE IF NOT EXISTS price_history (
        token TEXT NOT NULL,
        price REAL NOT NULL,
        ts INTEGER NOT NULL
    )""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_price_token_ts ON price_history(token, ts DESC)")
    return c

def append(token: str, price: float, ts: int, max_keep: int = 20) -> None:
    with _conn() as c:
        c.execute("INSERT INTO price_history (token, price, ts) VALUES (?, ?, ?)",
                  (token, price, ts))
        # Keep only the latest max_keep rows per token
        c.execute("""DELETE FROM price_history
                     WHERE rowid IN (
                       SELECT rowid FROM price_history
                       WHERE token = ?
                       ORDER BY ts DESC
                       LIMIT -1 OFFSET ?
                     )""", (token, max_keep))

def load(token: str, max_keep: int = 20) -> list[float]:
    with _conn() as c:
        rows = c.execute("""SELECT price FROM (
                              SELECT price, ts FROM price_history
                              WHERE token = ?
                              ORDER BY ts DESC
                              LIMIT ?
                            ) ORDER BY ts ASC""", (token, max_keep)).fetchall()
    return [r[0] for r in rows]
