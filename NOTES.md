# Entry notes — polymarket-faa-attribution-02

Account: brisk-koala-38 (make.fun). Payout wallet: 1485ixpCCggW1BFVPkPJALama8qQKHDv3E2f3fyiKfYT.
Built 2026-11-14; entries close 2026-11-14T14:00:00Z (22:00 WITA).

## Method (`main.ts`, Node 22, stdlib only)

For each market and each horizon h = 1..240 minutes after the checkpoint,
three spread components around the last price, blended 25/25/50:

1. Empirical quantiles of the market's own h-step price changes over the last
   4 hours (240 min), centered on their median, outer floor 0.0015·√h.
2. The same empirical quantiles of 1-step changes, scaled by √h.
3. A normal fan with sigma = RMS of 1-minute returns over the last 18 hours
   excluding jumps (|r| > 0.01), clamped [0.0005, 0.01], outer quantiles ×1.3.

Then two family-level adjustments:

- Sum mean-reversion: the sum of all markets' prices drifts back to 1,
  S(h) = 1 + (S0−1)·exp(−h/120); every row is multiplied by S(h)/S0.
- Level decay: the median gives back 3% toward the pack over the horizon,
  med(h) = med·(1 − 0.03·(1−exp(−h/120))).

Quantiles clamped to [0,1], rounded to 6 decimals, non-decreasing.

## Tuning (local scorer replicates RULES.txt pinball loss exactly; it
## reproduces the house baseline's published practice numbers to the digit)

Sweep of ~100 variants over 8 rounds on the six practice cases
(scorer: ../score.mjs, answers fetched from Polymarket's public history):

| variant | loss |
|---|---|
| house baseline (starter) | 0.363589 |
| NVIDIA entry method (empirical W480, floor 0.0015) | 0.303236 |
| empirical W240, floor 0.0015 | 0.296420 |
| blend W240 h-step + 1-step | 0.285948 |
| + trimmed-RMS normal fan (cross-family blend) | 0.278375 |
| + sum mean-reversion H120 | 0.267424 |
| + trim window 1440→1080 | 0.266593 |
| + level decay 0.03 | **0.264539** |

Things tried and rejected (with evidence): mean-reverting median to the
24h mean (worse, 0.297–0.58 — prices reverse trends but the anchor is too
noisy); adaptive normal fans with raw RMS/EWMA sigma (0.68–0.96 — jump
dominated); extrapolating the sum's own trend instead of mean-reverting it
(0.44, one case blew up to 0.995); jump widening (worse); horizon-band
multipliers (≤0.001 gain); pooled quantiles for young markets (no gain).

## Local validation

- Final entry on the six practice cases: **loss 0.264539** (baseline
  0.363589, i.e. 27.2% better), median error 0.746640, 90% coverage 0.9455,
  all cases valid. Per case: p00 0.398, p01 0.308, p02 0.342, p03 0.265,
  p04 0.203, p05 0.124 — no case blows up; p00 is the hardest (early case,
  big news-driven moves) and still the best of any variant tried there.
- Deterministic: two runs produce byte-identical outputs.
- Runtime: ~0.4 s per case (cap is 8 s). Output files ~200–250 KB (cap 1 MiB).

## What the parent still has to do (NOT done by this build)

- Create the public GitHub repo (after the 2026-11-14 02:00 UTC opening),
  push this repo, set its About from requirements.json `how_to_submit.repo_about`.
- Bundle the transcripts of the sessions that built this entry
  (`node cli/makefun.mjs bundle --repo <repo> --out transcripts.tar.gz`,
  with --redact for the user's personal details) and run
  `node cli/makefun.mjs check --kit <kit> --repo <repo> --transcripts transcripts.tar.gz`.
- Submit before 2026-11-14T14:00:00Z:
  `node cli/makefun.mjs submit --competition polymarket-faa-attribution-02
  --repo-url https://github.com/<owner>/<repo> --commit <sha>
  --title "<name>" --bundle transcripts.tar.gz --keypair <keypair>`
  (or the source-bundle route if no GitHub account is available).

## Caveats

- Practice is no guide to the final: the final grades on 12 fresh cases over
  48 hours of unseen FAA prices (2026-11-14 14:00Z → 2026-11-16 14:00Z),
  only 4 markets, much jumpier than the NVIDIA practice. A prize needs a loss
  strictly below the best house entry (baseline or house model forecast,
  whichever is lower) with all cases valid.
- The practice board's best entries at last check scored ~0.252; this entry
  at 0.2645 is close to, but not safely inside, the top 10 on practice.
  The final is a different event, so practice rank does not decide it.
- Top-100 places pay $1.50–$40; the entry must beat the best house entry on
  the final to take any place.
