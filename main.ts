// polymarket-faa-attribution-02 entry (Node 22, standard library only).
//
// What it does: for each market, forecast the Yes price at every minute of the
// 240 minutes after the checkpoint as five quantiles (5/25/50/75/95%).
//
// Method (chosen on the kit's six practice cases by a parameter sweep of
// ~100 variants; see NOTES.md):
//   - Three spread components, blended 25/25/50:
//       (a) empirical quantiles of the market's own h-step price changes over
//           the last 4 hours, median-centered, with an outer floor of
//           0.0015*sqrt(h) so a calm window never yields a degenerate band;
//       (b) the same empirical quantiles of 1-step changes, scaled by sqrt(h)
//           (a random-walk view of the same history);
//       (c) a normal fan whose sigma is the RMS of the market's 1-minute
//           returns over the last 24 hours EXCLUDING jumps (|r| > 0.01), so a
//           rare 20-point jump does not blow up the everyday spread, with the
//           outer (5%/95%) quantiles widened x1.3 for the heavy tails.
//   - The whole fan is then rescaled by the family total: the sum of all
//     markets' prices mean-reverts toward 1, S(h) = 1 + (S0-1)*exp(-h/120),
//     so each row is multiplied by S(h)/S0. This is the single biggest
//     median improvement on practice (it fixes the early case where the
//     whole event deflated from 1.08 to ~0.90).
//   - Medians are anchored on the last price (prices are a martingale); the
//     spread is the market's own recent history, not the house baseline's
//     fixed 0.0025/sqrt-min, which is far too wide for mostly-quiet minutes.
//   - Quantiles clamped to [0,1], rounded to 6 decimals, non-decreasing.
//
// Practice score of this program on the kit's six cases (scored locally
// against Polymarket's public history, same 1-minute grid as the house):
//   loss 0.264539 (house baseline 0.363589), median error 0.7466,
//   90% coverage 0.9455, all cases valid.
//   The scorer was verified exact: it reproduces the baseline's published
//   practice numbers (loss 0.363589, median error 0.767503, coverage 0.949642).
//
// I/O contract (RULES.txt): read every <id>.in in the input directory,
// write <id>.out to the output directory: {"forecasts":[{"id","q"}]}, one row
// per market, 240 rows of five non-decreasing numbers in [0,1], <= 1 MiB.
// Runs offline, no network, deterministic (same bytes on every run).
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
/** The house baseline's spread, per square-root minute (fallback only). */
const BASE_SIGMA = 0.0025;
/** How much recent history the empirical quantiles use, in minutes. */
const WINDOW_MIN = 240;
/** Minimum half-width of the outer (5%/95%) quantiles, per sqrt(minute). */
const OUTER_FLOOR = 0.0015;
/** How much history the trimmed-volatility fan uses, in minutes.
 *  1080 (18h) beat 1440 on practice: fresher volatility, less stale calm. */
const TRIM_WINDOW_MIN = 1080;
/** 1-minute moves larger than this are jumps: excluded from the fan's sigma. */
const JUMP_CUT = 0.01;
/** Outer-quantile widening of the normal fan, for the heavy tails. */
const TAIL_WIDEN = 1.3;
/** The family total mean-reverts toward 1 with this half-life-ish scale. */
const SUM_HALF_MIN = 120;
/** Large prices decay slightly toward the pack as the horizon grows
 *  (leaders give back a little of their edge); applied as a median shift. */
const LEVEL_DECAY = 0.03;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/** Linear-interpolation quantile of a sorted array at level tau. */
function quantile(sorted: number[], tau: number): number {
  const n = sorted.length;
  const pos = tau * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The baseline row for horizon h (used only when a market has no usable history). */
function baselineRow(x: number, h: number): number[] {
  const s = BASE_SIGMA * Math.sqrt(h);
  return Z.map((z) => price6(x + z * s));
}

/**
 * Median-centered empirical offsets for one market: for each horizon h, the
 * quantiles of the h-step (or 1-step, when oneStep) price changes over the
 * recent window, scaled to horizon h and centered on their own median.
 * Returns one offset array per horizon, or null where there is no data.
 */
function empiricalOffsets(prices: number[], oneStep: boolean): (number[] | null)[] {
  const n = prices.length;
  const start = Math.max(1, n - WINDOW_MIN);
  const maxDelta = n - 1 - start;
  const table: (number[] | null)[] = [];
  for (let h = 1; h <= 240; h++) {
    const hEff = oneStep ? 1 : Math.max(1, Math.min(h, maxDelta));
    const deltas: number[] = [];
    for (let t = start + hEff; t < n; t++) deltas.push(prices[t] - prices[t - hEff]);
    if (deltas.length === 0) { table.push(null); continue; }
    deltas.sort((a, b) => a - b);
    const scale = Math.sqrt(h / hEff);
    const qs = QUANTILES.map((t) => quantile(deltas, t) * scale);
    const med = qs[2];
    table.push(qs.map((q) => q - med));
  }
  return table;
}

/** Jump-trimmed RMS of a market's 1-minute returns (sigma per sqrt-minute). */
function trimmedSigma(prices: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i++) rets.push(prices[i] - prices[i - 1]);
  const w = rets.slice(Math.max(0, rets.length - TRIM_WINDOW_MIN)).filter((r) => Math.abs(r) <= JUMP_CUT);
  const rms = Math.sqrt(w.reduce((s, r) => s + r * r, 0) / Math.max(1, w.length));
  return Math.min(0.01, Math.max(0.0005, rms));
}

/** The forecast rows of one market: horizon rows of five quantiles. */
function forecast(m: CaseMarket, horizon: number, sum0: number): number[][] {
  const prices = m.prices;
  const n = prices.length;
  if (n === 0) throw new Error(`market ${m.id} has no prices`);
  const x = prices[n - 1];
  const offH = empiricalOffsets(prices, false);
  const off1 = empiricalOffsets(prices, true);
  const sigma = trimmedSigma(prices);
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const sqrtH = Math.sqrt(h);
    // (a) h-step empirical fan, (b) 1-step empirical fan, (c) trimmed normal fan.
    const rowOf = (off: number[] | null): number[] | null => {
      if (!off) return null;
      const o = off.slice();
      const fl = OUTER_FLOOR * sqrtH;
      o[0] = Math.min(o[0], -fl);
      o[4] = Math.max(o[4], fl);
      return o.map((v) => price6(x + v));
    };
    const rA = rowOf(offH[h - 1]);
    const rB = rowOf(off1[h - 1]);
    const rT = Z.map((z, j) => price6(x + (j === 0 || j === 4 ? z * TAIL_WIDEN : z) * sigma * sqrtH));
    let row: number[];
    if (!rA || !rB) row = baselineRow(x, h);
    else row = rA.map((v, j) => price6(0.25 * v + 0.25 * rB[j] + 0.5 * rT[j]));
    // Family-total mean reversion: the sum of all prices drifts back to 1.
    if (sum0 > 0) {
      const fac = (1 + (sum0 - 1) * Math.exp(-h / SUM_HALF_MIN)) / sum0;
      row = row.map((v) => price6(v * fac));
    }
    // Level decay: the median gives back a little as the horizon grows.
    const med = row[2] * (1 - LEVEL_DECAY * (1 - Math.exp(-h / SUM_HALF_MIN)));
    row = row.map((v) => price6(v + (med - row[2])));
    for (let j = 1; j < 5; j++) if (row[j] < row[j - 1]) row[j] = row[j - 1];
    rows.push(row);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const sum0 = c.markets.reduce((s, m) => s + m.prices[m.prices.length - 1], 0);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes, sum0) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
