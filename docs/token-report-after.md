Token use by stage — 9 runs in debug/ since 2026-09-24_17, total $8.75

| stage | rounds | cost | share | input (uncached) | cache write | cache read | cache hit | output | of which answer (est.) | answer tokens / part |
|---|---|---|---|---|---|---|---|---|---|---|
| design (single pass) | 5 | $2.82 | 32% | 32 | 76.6k | 111.6k | 59% | 120.9k | 7.3k (6%) | 9.4 |
| sub-build | 14 | $2.35 | 27% | 450 | 28.6k | 189.2k | 87% | 108.1k | 4.8k (4%) | 11.0 |
| comparison | 4 | $0.96 | 11% | 20 | 71.3k | 62.8k | 47% | 29.7k | 3.1k (10%) | 4.5 |
| assembly | 4 | $0.72 | 8% | 208 | 35.2k | 0 | 0% | 27.2k | 1.4k (5%) | 1.8 |
| assembly · repair | 10 | $0.52 | 6% | 808 | 67.4k | 0 | 0% | 8.8k | 798 (9%) | 1.0 |
| analysis | 5 | $0.35 | 4% | 116 | 55.6k | 0 | 0% | 3.7k | 2.8k (76%) | – |
| design (single pass) · repair | 2 | $0.29 | 3% | 8 | 50.2k | 12.5k | 20% | 1.6k | 128 (8%) | 0.5 |
| sub-build · repair | 2 | $0.26 | 3% | 8 | 41.6k | 13.4k | 24% | 2.5k | 852 (35%) | 8.7 |
| comparison · repair | 2 | $0.26 | 3% | 8 | 19.9k | 41.1k | 67% | 7.6k | 749 (10%) | 1.4 |
| plan | 4 | $0.22 | 3% | 208 | 28.9k | 0 | 0% | 3.8k | 2.3k (61%) | 2.8 |

| cost by token kind | $ | share |
|---|---|---|
| output: answer (JSON) | $0.48 | 6% |
| output: thinking | $5.79 | 66% |
| input: cache writes | $2.38 | 27% |
| input: cache reads | $0.09 | 1% |
| input: uncached | $0.01 | 0% |

| model · effort | rounds | output tokens | output / round | cost |
|---|---|---|---|---|
| claude-opus-5-5 · medium | 30 | 67.7k | 2.3k | $2.65 |
| claude-opus-5-5 · high | 22 | 246.1k | 11.2k | $6.10 |
