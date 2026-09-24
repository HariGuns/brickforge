Token use by stage — 18 runs in debug/, total $11.20

| stage | rounds | cost | share | input (uncached) | cache write | cache read | cache hit | output | of which answer (est.) | answer tokens / part |
|---|---|---|---|---|---|---|---|---|---|---|
| sub-build | 19 | $5.00 | 45% | 76 | 18.5k | 95.2k | 84% | 244.3k | 34.2k (14%) | 22.9 |
| design (single pass) | 13 | $3.89 | 35% | 52 | 23.1k | 26.5k | 53% | 188.2k | 31.1k (17%) | 22.3 |
| assembly | 3 | $0.69 | 6% | 12 | 26.2k | 0 | 0% | 28.2k | 8.4k (30%) | 2.1 |
| edit | 2 | $0.43 | 4% | 8 | 26.0k | 0 | 0% | 15.1k | 7.6k (51%) | 11.2 |
| sub-build · repair | 3 | $0.39 | 4% | 12 | 36.3k | 17.6k | 33% | 10.4k | 5.1k (49%) | 22.4 |
| assembly · repair | 2 | $0.33 | 3% | 8 | 17.1k | 16.6k | 49% | 12.0k | 5.1k (42%) | 3.1 |
| design (single pass) · repair | 2 | $0.27 | 2% | 8 | 25.7k | 7.4k | 22% | 6.9k | 3.6k (52%) | 21.6 |
| plan | 3 | $0.20 | 2% | 12 | 14.5k | 0 | 0% | 6.2k | 2.9k (46%) | 0.7 |

| cost by token kind | $ | share |
|---|---|---|
| output: answer (JSON) | $1.96 | 18% |
| output: thinking | $8.26 | 74% |
| input: cache writes | $0.94 | 8% |
| input: cache reads | $0.03 | 0% |
| input: uncached | $0.00 | 0% |
