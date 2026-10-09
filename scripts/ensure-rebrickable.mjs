// Creates an empty src/lib/bricklink/rebrickable.json if there isn't one (it isn't in the repo).
// The real one comes from `npm run fetch-bricklink` with your own Rebrickable API key; until then,
// catalog parts in the BrickLink wanted list keep their LDraw numbers (most match BrickLink's).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "bricklink", "rebrickable.json");
if (!fs.existsSync(file)) {
  const stub = { generated: null, source: "empty: run npm run fetch-bricklink with REBRICKABLE_API_KEY in .env.local", colors: {}, parts: {}, unmatched: [], coreTableMissing: [], coreTableRenamed: {} };
  fs.writeFileSync(file, JSON.stringify(stub, null, 1) + "\n");
  console.log("Created an empty src/lib/bricklink/rebrickable.json (run npm run fetch-bricklink to fill it).");
}
