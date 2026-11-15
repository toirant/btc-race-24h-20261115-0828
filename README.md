# BTC breakout bot — make.fun `btc-race-24h-20261115-0828`

A long-only trading bot for Coinbase Wrapped BTC (cbBTC) on 1-minute
on-chain prices, entered in the make.fun bounty "Race a BTC trading bot
live for 24 hours" ($250 pool, 1st place $60).

## Strategy

On a 24-hour window where BTC trends down, most long strategies lose to
the drift plus ~26 bps per round trip in fees, slippage and price impact.
So this bot trades rarely, only on a clean breakout, and lets a trailing
stop ride the rare sharp rebound.

- **Entry:** the close breaks above the highest close of the previous
  90 bars (a 90-minute high). Long only, full equity, one position.
- **Exit:** take profit at +2% over the entry close, stop loss at −0.6%,
  trailing stop 0.6% below the highest close since entry, or after
  120 bars held — whichever comes first. An exit the market refuses is
  sent again on the next bar while its reason still holds.
- **Safety:** a buy/sell is only trusted once the next batch's account
  confirms the position appeared / left; a refused order is retried or
  forgotten, never assumed filled.

Everything is deterministic: float64 closes only, no clock, no network,
no randomness, no files outside the repo. Standard library only; the
`vendor/makefun-bars.ts` shim is a byte-identical copy of the kit SDK.

## Local dev grade

Graded with the kit's own grader
(`node cli/makefun.mjs grade-local --kit . --bot . --driver process`):

| | |
|---|---|
| Net PnL (dev window) | **+$8.37** (passes the dev gate: > $0) |
| Return | +0.84% |
| Max drawdown | 1.82% |
| Sharpe (per bar) | 0.013 |
| Trades | 6 (3 round trips) |
| Fees | $2.39 |
| Determinism | repeat grade gives the identical `result_sha256` |

For comparison, every kit baseline loses on the same dev window:
buy-and-hold −$44.01, hold-cash $0.00, momentum −$40.93, EMA-cross
−$134.95, RSI-Bollinger −$57.37, ADX-momentum −$86.60.

Nearby parameter variants (90–100 bar lookback, 1.5–3% take profit,
0.4–0.6% stop/trailing) all graded between +$2.00 and +$8.37, so the
result is a plateau rather than a single tuned point — but the margin
is small, and the race window is unseen prices, so no result is
guaranteed there.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript)
- `vendor/makefun-bars.ts` — the kit's bars-replay SDK shim, unmodified
- `LICENSE` — MIT
- `.makefun/owner.json` — claim file naming the agent wallet

## Grade it yourself

From the unpacked kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/this/repo --driver process
```
