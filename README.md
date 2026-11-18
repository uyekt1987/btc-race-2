# BTC Race Bot — Fast-Mean Reversion on cbBTC

[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![Rank](https://make.fun/badge/btc-race-24h-20261118-1444/uyekt1987/btc-race-2/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![Reward](https://make.fun/badge/btc-race-24h-20261118-1444/uyekt1987/btc-race-2/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

Entry for make.fun `btc-race-24h-20261118-1444`: a bot that trades Coinbase
Wrapped BTC (CBBTC) against USDC on 1-minute bars, starting with $1,000 of
paper money, long only.

## Strategy

Mean reversion against a FAST mean, not the slow one the previous race used.
The dev window opens with a sharp crash (65,083 → 63,366 in the first ~70
minutes, −267 bps), then chops sideways-to-down and ends −280 bps below the
start, while a full-size round trip costs ~26 bps (4 bps fee + 2 bps
slippage + ~7 bps pool impact per side at this window's ~$840k mean depth).
The old bot's SMA(240) barely moves during the opening crash, so its dip
fires late and high — on this window it loses −$3.53.

- **Mean:** SMA(60) of 1-minute closes (~1 h). A −100 bps dip below it
  only fires once the price has actually fallen hard.
- **Entry (flat):** close ≤ SMA × (1 − 100 bps), and only up to bar 1320
  (no entries in the final 120 bars — a dip-buy needs hours to revert,
  and a position opened in the final 2 h can only be flattened at the
  last close). Buy with all cash.
- **Exit (long), first of:**
  - recovery: close ≥ SMA × (1 + 120 bps) — let a winner run, so the
    ~26 bps round trip does not eat the trade;
  - stop-loss: close ≤ entry close × (1 − 150 bps) — catastrophe
    insurance only; tight stops were tested and rejected, because the
    winning trade dips a further ~100+ bps below its entry before
    recovering;
  - time-stop: held 480 bars (~8 h) without recovering — the recovery
    on this window takes most of the day.
- **Cooldown:** no new entry within 10 bars of an exit.
- **Slippage cap:** 100 bps per order; signals are level-based, so a refused
  order is retried on the next bar while the condition still holds.
- **Size:** 100% of cash on entry, whole position on exit. At most one order
  per reply.

What was rejected, with numbers on the dev window: EMA crossovers
(8/21, 12/48, 5/20, 21/55) lose $58–$121 by whipsawing; breakouts lose
$12–$17; rolling-low "bounce" entries lose $20–$48 — in a falling grind
most local lows are not bottoms.

Robustness, not peak fit: the whole neighbourhood SMA(45..70) ×
dip(85..105 bps) with these exits is positive on BOTH this dev window
(+$8.21..+$20.65) and the previous race's dev window, an entirely
different 24 h (+$10.62..+$27.78). The chosen point, SMA(60) / dip
100 bps, sits in the middle of that plateau — deliberately not the
+$20.65 peak (SMA(70)), which is the same trade entered 7 bars later at
the exact crash bottom and whose immediate neighbours (SMA(80)) do not
trade at all.

Deterministic: pure arithmetic on the closes seen so far — no clock, no
environment, no randomness. Two runs produce byte-identical action logs
(verified).

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit SDK shim.
- `LICENSE` — MIT.

## Local backtest (dev window)

The backtest runner lives outside this repo, in
`~/workspace/makefun/btc-race-tools/backtest2.mjs` (adapted from the
previous race's runner to point at this kit). It replays the dev bars
through the bot over stdin/stdout with the grader's exact fill math
(fee 4 bps, slippage 2 bps, constant-product impact against each bar's open
depth) and reports net PnL, trades and max drawdown.

Dev-window result: **net PnL +$9.16, 2 trades, max drawdown $15.02 (1.50%)**
— buy bar 63 @ $64,125.89, sell bar 543 @ $64,765.33 (time-stop).
Split-half (each half re-run standalone, indicators re-seeded):
first 12 h +$9.16 (same trade), second 12 h −$3.43 (1 trade — an
artefact of the re-seeded slice: in the full run the no-entry-after-1320
rule blocks that final-hour entry, so the full run makes no trade at all
in the second half and its contribution there is $0.00).

Comparisons on the same window: previous race's bot −$3.53 (3 trades),
buy-and-hold −$31.63, EMA(8/21) baseline −$148.17 (80 trades).

Cross-check on the previous race's dev window (a different 24 h):
**+$13.25, 2 trades, max drawdown $6.26** — better than the old bot's
+$10.28 there.
