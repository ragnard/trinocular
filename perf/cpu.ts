import type { Protocol } from "puppeteer-core";

export interface TopFunction {
  fn: string;
  selfMs: number;
}

const short = (url: string) =>
  url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\?.*$/, "")
    .replace(/^\/node_modules\/\.vite\/deps\//, "deps/")
    .replace(/^\/@fs\/.*\/packages\//, "packages/")
    .replace(/^\/src\//, "");

/**
 * Self time per function from a V8 CPU profile: each sample charges its time
 * delta to the node it landed on. `(idle)` is dropped; `(program)` is kept,
 * being everything on the thread that is not JavaScript — the trace says what.
 *
 * The native `performance.mark` frame is dropped too. With the timeline trace
 * category on, Blink forces a profiler sample at every mark so DevTools can
 * line marks up with the flame chart, and that sample is charged the whole
 * interval since the previous one — which made a 6µs call read as ~1ms each,
 * 70ms over a run. The time is real but was spent in whatever ran before the
 * mark, so it is left out rather than moved.
 */
export function topFunctions(profile: Protocol.Profiler.Profile, n = 12): TopFunction[] {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    self.set(samples[i], (self.get(samples[i]) ?? 0) + deltas[i]);
  }
  const byFn = new Map<string, number>();
  for (const [id, t] of self) {
    const cf = byId.get(id)!.callFrame;
    if (cf.functionName === "(idle)" || (cf.functionName === "mark" && !cf.url)) continue;
    const where = cf.url ? ` ${short(cf.url)}:${cf.lineNumber + 1}` : "";
    const key = `${cf.functionName || "(anonymous)"}${where}`;
    byFn.set(key, (byFn.get(key) ?? 0) + t);
  }
  return [...byFn]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([fn, us]) => ({ fn, selfMs: Math.round(us / 100) / 10 }));
}
