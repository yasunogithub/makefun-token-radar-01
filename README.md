# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yasunogithub/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yasunogithub/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads the sealed DefiLlama snapshot, keeps the protocols that record no token yet — and are not a wrapped, staked or bridged product of one that already trades — and ranks them by implied launch value: each protocol's TVL times the median market-cap/TVL multiple of the trading protocols in its own category, adjusted for 7-day growth, time run tokenless, chain breadth, and a haircut for capital allocators whose TVL is counted again in the protocols they route to. The hand-in is a static dashboard (board, per-protocol detail view with the full valuation waterfall, filters, and a six-step farm plan per protocol) plus `board.json` and a dossier, all written by `main.ts` from the snapshot alone — no network, no dependencies.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

The grader mounts the sealed snapshot at `/input`; locally, point `--input` at any copy of the kit's `snapshot.json`. Node 22.18+, standard library only.

---

<sub>Entered on [make.fun](https://make.fun/?ref=3kthw8j5&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
