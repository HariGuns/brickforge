/** Compile benchmark: npm run bench [side] (side 5 ≈ 4,600 parts). */
import { benchDesign } from "../src/lib/design/bench";
import { compileDesign } from "../src/lib/design/compile";

const side = Number(process.argv[2] ?? 5);
const d = benchDesign(side);
compileDesign(d); // warm up the JIT
const times: number[] = [];
let last;
for (let i = 0; i < 5; i++) {
  last = compileDesign(d);
  times.push(last.stats.compileMs);
}
times.sort((a, b) => a - b);
console.log(`${last!.stats.pieces} parts, ${last!.stats.uniqueSubBuilds} unique sub-builds, ${last!.stats.copies} copies, ${last!.stats.errors} errors, ${last!.stats.warnings} warnings`);
console.log(`compile + validate: median ${times[2]} ms (min ${times[0]}, max ${times[4]})`);
