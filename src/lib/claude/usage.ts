import { CONFIG } from "../config";

export interface RoundUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Estimated USD. */
  cost: number;
}

interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function toRoundUsage(u: ApiUsage): RoundUsage {
  const p = CONFIG.pricing;
  const r = {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  const cost = (r.input * p.input + r.output * p.output + r.cacheRead * p.cacheRead + r.cacheWrite * p.cacheWrite) / 1e6;
  return { ...r, cost };
}

export function sumUsage(rounds: RoundUsage[]): RoundUsage {
  return rounds.reduce(
    (a, r) => ({ input: a.input + r.input, output: a.output + r.output, cacheRead: a.cacheRead + r.cacheRead, cacheWrite: a.cacheWrite + r.cacheWrite, cost: a.cost + r.cost }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  );
}

export function formatUsage(u: RoundUsage): string {
  return `in ${u.input} · out ${u.output} · cache read ${u.cacheRead} · cache write ${u.cacheWrite} · ~$${u.cost.toFixed(4)}`;
}
