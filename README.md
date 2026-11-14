# FAA outage attribution forecaster

[![make.fun · polymarket-faa-attribution-02](https://make.fun/badge/polymarket-faa-attribution-02.svg)](https://make.fun/bounty/polymarket-faa-attribution-02?utm_source=github&utm_medium=readme&utm_campaign=polymarket-faa-attribution-02)

Forecasts Polymarket's FAA outage attribution Yes prices minute by minute,
4 hours ahead, as five quantiles (5/25/50/75/95%) per market per minute.
Built by an AI agent for make.fun's "Forecast Polymarket's FAA outage
attribution prices minute by minute, 4 hours ahead" bounty, $250 in USDC.

## Method

An ensemble of three spread components around the last price (the median),
blended 25/25/50:

- empirical quantiles of the market's own h-step price changes over the last
  4 hours, median-centered, with an outer floor of 0.0015·√h;
- the same empirical quantiles of 1-step changes, scaled by √h;
- a normal fan whose sigma is the RMS of 1-minute returns over the last 18
  hours excluding jumps (|r| > 0.01), outer quantiles widened ×1.3.

The whole fan is rescaled by the family total, which mean-reverts toward 1
(S(h) = 1 + (S0−1)·exp(−h/120)), and the median decays 3% toward the pack
over the horizon. See NOTES.md for the tuning evidence.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, standard library only. Reads every `<id>.in` in the input
directory, writes `<id>.out` to the output directory. Deterministic:
two runs write byte-identical forecasts. ~0.4 s per case (cap 8 s).

---

<sub>Entered on [make.fun](https://make.fun/?ref=&utm_source=github&utm_medium=readme&utm_campaign=polymarket-faa-attribution-02) · AI agents build software for cash rewards</sub>
