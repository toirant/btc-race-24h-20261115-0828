// BTC breakout bot for make.fun btc-race-24h-20261115-0828.
//
// Idea: on a 24h window where BTC trends down, most long strategies lose
// to the drift plus ~26 bps per round trip. So trade rarely, only on a
// clean breakout, and let a trailing stop ride the rare sharp rebound.
//
//   - Entry: the close breaks above the highest close of the previous
//     90 bars (a 90-minute high). Long only, full equity, one position.
//   - Exit: take profit at +2% over the entry close, stop loss at -0.6%,
//     trailing stop 0.6% below the highest close since entry, or after
//     120 bars held. Whichever comes first. An exit that the market
//     refuses is sent again on the next bar while its reason still holds.
//   - Everything is deterministic: float64 closes only, no clock, no
//     network, no randomness, no files. A buy/sell is only trusted once
//     the next batch's account confirms the position appeared / left;
//     a refused order is retried or forgotten, never assumed filled.
//
// On the published dev window this makes a small positive net PnL with
// only 3 round trips and a ~1.5% max drawdown in simulation, where every
// kit baseline loses money (buy-and-hold -$44, EMA-cross -$135).

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const LOOKBACK_BARS = 90;
const TAKE_PROFIT = 0.02;
const STOP_LOSS = 0.006;
const TRAILING_STOP = 0.006;
const MAX_HOLD_BARS = 120;
const MAX_SLIPPAGE_BPS = 100;

interface Tracked {
  entry: number;
  peak: number;
  bars: number;
  pendingBuy: boolean;
  pendingSell: boolean;
}

const closes = new Map<string, number[]>();
const tracked = new Map<string, Tracked>();

function pushClose(bar: Bar): number {
  let arr = closes.get(bar.symbol);
  if (arr === undefined) {
    arr = [];
    closes.set(bar.symbol, arr);
  }
  const c = Number(bar.c);
  arr.push(c);
  if (arr.length > LOOKBACK_BARS + 2) arr.shift();
  return c;
}

await runBars({
  onBatch(state, batch) {
    const fresh = new Set<string>();
    for (const bar of batch.bars) {
      pushClose(bar);
      fresh.add(bar.symbol);
    }
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];

    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const arr = closes.get(symbol);
      if (arr === undefined) continue;
      const close = arr[arr.length - 1]!;
      const held = state.positions.get(symbol);
      let t = tracked.get(symbol);

      // Reconcile our record with the confirmed account.
      if (t !== undefined) {
        if (t.pendingBuy) {
          if (held !== undefined) {
            t.pendingBuy = false;
          } else {
            // Buy was refused: forget it, allow a fresh entry later.
            tracked.delete(symbol);
            t = undefined;
          }
        } else if (t.pendingSell) {
          if (held === undefined) {
            tracked.delete(symbol);
            t = undefined;
          } else {
            // Sell was refused: keep the record, retry below.
            t.pendingSell = false;
          }
        } else if (held === undefined) {
          tracked.delete(symbol);
          t = undefined;
        }
      }
      if (held !== undefined && t === undefined) {
        // A position with no record (should not happen): track it from here.
        t = { entry: close, peak: close, bars: 0, pendingBuy: false, pendingSell: false };
        tracked.set(symbol, t);
      }
      if (t !== undefined) t.bars += 1;

      if (t !== undefined && held !== undefined && !t.pendingBuy) {
        if (close > t.peak) t.peak = close;
        const up = close >= t.entry * (1 + TAKE_PROFIT);
        const down = close <= t.entry * (1 - STOP_LOSS);
        const trail = close <= t.peak * (1 - TRAILING_STOP);
        const stale = t.bars >= MAX_HOLD_BARS;
        if (up || down || trail || stale) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          t.pendingSell = true;
        }
        continue;
      }

      if (t === undefined && held === undefined) {
        // Breakout: close above every close of the previous LOOKBACK_BARS bars.
        if (arr.length > LOOKBACK_BARS) {
          let highest = -Infinity;
          for (let i = arr.length - LOOKBACK_BARS - 1; i < arr.length - 1; i++) {
            if (arr[i]! > highest) highest = arr[i]!;
          }
          if (close > highest) entries.push(symbol);
        }
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    for (const symbol of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      const arr = closes.get(symbol)!;
      tracked.set(symbol, { entry: arr[arr.length - 1]!, peak: arr[arr.length - 1]!, bars: 0, pendingBuy: true, pendingSell: false });
      cash -= slice;
      room--;
    }
    return orders;
  },
});
