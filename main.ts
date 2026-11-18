// Mean-reversion bot for the make.fun BTC race (btc-race-24h-20261118-1444).
//
// One asset, CBBTC/USDC, long only, full size, at most one position at a time.
//
// Why this shape, and why it differs from the previous race's bot:
//   - The new dev window is NOT the old one. It opens with a sharp crash
//     (65,083 -> 63,366 in the first ~70 minutes, -267 bps), then chops
//     sideways-to-down for the rest of the day and ends -280 bps below the
//     start. The old bot's slow mean, SMA(240), barely moves during that
//     opening crash, so its -80 bps dip fires late and high, and its
//     recovery exit then sells into the grind: on this window the old
//     parameters lose -$3.53.
//   - A FAST mean, SMA(60) of 1-minute closes (~1 h), tracks the crash
//     closely enough that a -100 bps dip below it only fires once the price
//     has actually fallen hard, near the bottom of a real air pocket —
//     and then the trade needs TIME: the recovery back up takes most of
//     the day, so the time-stop is long (480 bars, ~8 h) and the recovery
//     bar is set at +100 bps above the mean, so the bot lets a winner
//     run instead of banking a thin +50 bps that the ~26 bps round trip
//     would mostly eat. Tight stop-losses were tested and rejected: on
//     this window the winning trade dips a further ~100+ bps below its
//     entry before recovering, so a 50-100 bps stop just locks in the
//     worst of the crash. The stop stays wide, at 150 bps below entry,
//     as catastrophe insurance only.
//   - Revision (exit sweep, 2026-11-18, backtest2.mjs on both windows):
//     RECOVER_BPS 80/100/120 and MAX_HOLD_BARS 360/480/600, one at a
//     time. Recovery 80 fires early (bar 406) and banks only +$4.32 on
//     the new window, -$4.84 vs the time-stop exit; 100 and 120 never
//     fire on either window (price never reaches even +100 bps above
//     the mean — first +80 bps is bar 406 new, never on the old window),
//     so both exits are the 480-bar time-stop and give identical
//     results: +$9.16 new / +$13.25 old, same drawdowns. 100 is the
//     lower edge of that proven-inert plateau: it keeps every cent on
//     both dev windows and exits earlier if the live race recovers
//     harder than either of them. MAX_HOLD 480 is the local optimum —
//     360 gives +$1.03 / +$8.80, 600 gives +$2.31 / +$3.45 (and old
//     drawdown worsens to $15.97), so 480 stays. Raising LAST_ENTRY_BAR
//     to 1439 was tested and rejected: the late dip (bar 1434) buys at
//     $63,322 and flattens at $63,260.75, losing $3.49, so 1320 stays.
//   - Momentum is dead on this market: every EMA crossover tested
//     (8/21, 12/48, 5/20, 21/55) loses $58-$121 on the dev window by
//     whipsawing through the 4 bps fee + 2 bps slippage + ~7 bps impact
//     per side. Breakouts and rolling-low "bounce" entries lose too
//     (-$12 to -$48): in a falling grind most local lows are not bottoms.
//   - Robustness, not peak fit: the parameter surface here is one big
//     trade, so a single number is meaningless. The whole neighbourhood
//     SMA(45..70) x dip(85..105 bps) with these exits is positive on
//     BOTH the new dev window (+$8.21..+$20.65) and the previous race's
//     dev window (+$10.62..+$27.78, an entirely different 24 h), and the
//     chosen point, SMA(60) / dip 100 bps, sits in the middle of that
//     plateau — deliberately NOT the +$20.65 peak (SMA(70)), which is
//     the same trade entered 7 bars later at the exact crash bottom and
//     whose immediate neighbours (SMA(80)) do not trade at all.
//   - No entry in the last 120 bars: a dip-buy needs hours to revert,
//     and a position opened in the final 2 h can only be flattened at
//     the last close. On the dev window that late entry (bar ~1435)
//     loses ~$3.49; skipping it is worth more than any recovery it
//     could plausibly complete.
//
// Rules (all on 1-minute closes, all thresholds in basis points):
//   - Mean: SMA(60) of closes (~1 h). No signal until it is seeded.
//   - Entry, when flat: close <= SMA * (1 - 100 bps), and bar index
//     <= 1320 (no entries in the final 120 bars). Buy with all cash.
//   - Exit, when long, whichever comes first:
//       * recovery: close >= SMA * (1 + 100 bps);
//       * stop-loss: close <= entry close * (1 - 150 bps);
//       * time-stop: held 480 bars (~8 h) without recovering.
//   - Cooldown: no new entry within 10 bars of an exit.
//   - max_slippage_bps 100 (1%): a fill more than 1% past the close it was
//     decided on is refused rather than chased. The signals are level-based
//     (they stay true while the condition holds), so a refused order is simply
//     sent again on the next bar.
//   - Position: 100% of cash on entry, the whole position on exit. At most one
//     order per reply; the harness flattens anything still held at the end.
//
// Determinism: pure float arithmetic on the closes seen so far; no clock, no
// environment, no Math.random. Two runs on the same bars give the same orders.

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Bars in the fast mean (about one hour of 1-minute closes). */
const SMA_BARS = 60;
/** Entry: close this far below the fast mean (bps). */
const DIP_BPS = 100;
/** Exit on recovery: close this far above the fast mean (bps). Lowered
 *  120 -> 100 by the exit sweep: identical on both dev windows, exits
 *  earlier in a stronger live recovery (see header). */
const RECOVER_BPS = 100;
/** Exit on stop-loss: close this far below the entry close (bps). */
const STOP_BPS = 150;
/** Exit on time-stop: bars held without recovering. */
const MAX_HOLD_BARS = 480;
/** Bars to wait after an exit before a new entry. */
const COOLDOWN_BARS = 10;
/** No new entry once this many bars of the window have been seen. */
const LAST_ENTRY_BAR = 1320;
const MAX_SLIPPAGE_BPS = 100;

/** The last SMA_BARS closes, in order, once seeded. */
const closes: number[] = [];
let smaSum = 0;
/** Close at which the current position was entered (decision bar's close). */
let entryClose = 0;
/** Bar index (count of CBBTC bars seen) at which the current position was entered. */
let entryBar = -1;
/** Bar index at which the last exit was decided. */
let lastExitBar = -1e9;
/** Bar index counter: CBBTC bars seen so far. */
let barNo = -1;

/** SMA(60) of the closes seen, once seeded; null before that. */
function fastMean(): number | null {
  if (closes.length < SMA_BARS) return null;
  return smaSum / SMA_BARS;
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined || state.warmingUp) return [];
    barNo++;
    const close = Number(bar.c);
    closes.push(close);
    smaSum += close;
    if (closes.length > SMA_BARS) smaSum -= closes.shift()!;

    const mean = fastMean();
    if (mean === null) return [];
    const held = state.positions.get(SYMBOL);
    const dip = close <= mean * (1 - DIP_BPS / 10000);
    const recovered = close >= mean * (1 + RECOVER_BPS / 10000);

    if (held !== undefined) {
      const stopped = close <= entryClose * (1 - STOP_BPS / 10000);
      const timedOut = barNo - entryBar >= MAX_HOLD_BARS;
      if (recovered || stopped || timedOut) {
        lastExitBar = barNo;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }

    if (barNo - lastExitBar < COOLDOWN_BARS) return [];
    if (barNo > LAST_ENTRY_BAR) return [];
    if (!dip) return [];
    const room = state.weightRoom(SYMBOL);
    let spend = state.cash < room ? state.cash : room;
    if (spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    entryClose = close;
    entryBar = barNo;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
