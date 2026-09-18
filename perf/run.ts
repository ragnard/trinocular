import { mkdir } from "node:fs/promises";
import { topFunctions, type TopFunction } from "./cpu";
import type { Outcome } from "./scenario";
import { scenarios } from "./scenarios";
import { Session } from "./session";
import { CATEGORIES, Trace, type PhaseSummary } from "./trace";

interface Summary extends Outcome {
  scenario: string;
  at: string;
  url: string;
  phases: Record<string, PhaseSummary & { top: TopFunction[] }>;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const url = flag("--url") ?? process.env.PERF_URL ?? "http://localhost:5173/";
const out = flag("--out") ?? "perf/out";
const compare = args.indexOf("--compare");
if (compare >= 0) {
  await printComparison(args[compare + 1], args[compare + 2]);
  process.exit(0);
}

const wanted = args.length ? scenarios.filter((s) => args.includes(s.name)) : scenarios;
const unknown = args.filter((a) => !scenarios.some((s) => s.name === a));
if (unknown.length) {
  console.error(
    `Unknown scenario ${unknown.join(", ")}; have ${scenarios.map((s) => s.name).join(", ")}`
  );
  process.exit(2);
}

let failed = false;
for (const scenario of wanted) {
  console.log(`\n== ${scenario.name} — ${scenario.description}`);
  const dir = `${out}/${scenario.name}`;
  await mkdir(dir, { recursive: true });
  const session = await Session.launch(url);
  try {
    await session.page.tracing.start({
      path: `${dir}/trace.json`,
      categories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "blink.user_timing",
        "v8.execute"
      ]
    });
    const read = await scenario.run(session);
    await session.page.tracing.stop();
    const trace = await Trace.load(`${dir}/trace.json`);
    const outcome = read(trace);
    const phases: Summary["phases"] = {};
    for (const phase of session.phases) {
      await Bun.write(`${dir}/${phase.name}.cpuprofile`, JSON.stringify(phase.profile));
      phases[phase.name] = { ...trace.phase(phase.name), top: topFunctions(phase.profile) };
    }
    const summary: Summary = {
      scenario: scenario.name,
      at: new Date().toISOString(),
      url,
      phases,
      ...outcome
    };
    await Bun.write(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
    print(summary);
    if (Object.values(outcome.checks ?? {}).some((ok) => !ok)) failed = true;
  } catch (e) {
    failed = true;
    console.error(`  failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    await session.close();
  }
}
process.exit(failed ? 1 : 0);

function print(s: Summary) {
  const ms = (n: number) => String(Math.round(n)).padStart(7);
  console.log(
    `  ${"phase".padEnd(9)}${"wall".padStart(7)}${"main".padStart(7)}${CATEGORIES.map((c) => c.padStart(7)).join("")}${"layouts".padStart(9)}${"gc".padStart(6)}${"long".padStart(6)}`
  );
  for (const p of Object.values(s.phases)) {
    console.log(
      `  ${p.name.padEnd(9)}${ms(p.wallMs)}${ms(p.mainMs)}${CATEGORIES.map((c) => ms(p.byCategory[c])).join("")}${String(p.counts.layout).padStart(9)}${String(p.counts.minorGc + p.counts.majorGc).padStart(6)}${String(p.longTasks.length).padStart(6)}`
    );
  }
  for (const p of Object.values(s.phases)) {
    for (const t of p.longTasks) {
      console.log(
        `  long task in ${p.name}: ${t.durMs}ms at +${t.atMs}ms${t.top ? ` — ${t.top}` : ""}`
      );
    }
  }
  const measured = Object.values(s.phases).filter((p) => p.name !== "open");
  for (const p of measured) {
    const top = p.top
      .filter((f) => !f.fn.startsWith("(program)"))
      .slice(0, 6)
      .map((f) => `${f.fn} ${f.selfMs}`)
      .join(", ");
    console.log(`  top ${p.name}: ${top}`);
  }
  console.log(
    `  ${Object.entries(s.metrics)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ")}`
  );
  for (const [name, ok] of Object.entries(s.checks ?? {})) {
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  }
}

async function printComparison(a: string, b: string) {
  const load = async (path: string): Promise<Summary[]> => {
    if (path.endsWith(".json")) return [await Bun.file(path).json()];
    const glob = new Bun.Glob("*/summary.json");
    const list: Summary[] = [];
    for await (const file of glob.scan(path)) list.push(await Bun.file(`${path}/${file}`).json());
    return list.sort((x, y) => x.scenario.localeCompare(y.scenario));
  };
  const before = await load(a);
  const after = await load(b);
  const pct = (x: number, y: number) =>
    x === 0 ? (y === 0 ? "" : "new") : `${y >= x ? "+" : ""}${Math.round(((y - x) / x) * 100)}%`;
  for (const s2 of after) {
    const s1 = before.find((s) => s.scenario === s2.scenario);
    if (!s1) continue;
    console.log(`\n== ${s2.scenario}`);
    for (const [name, p2] of Object.entries(s2.phases)) {
      const p1 = s1.phases[name];
      if (!p1) continue;
      console.log(
        `  ${name.padEnd(9)} main ${Math.round(p1.mainMs)} → ${Math.round(p2.mainMs)} ${pct(p1.mainMs, p2.mainMs)}`
      );
    }
    for (const [k, v2] of Object.entries(s2.metrics)) {
      const v1 = s1.metrics[k];
      if (typeof v1 !== "number" || typeof v2 !== "number") continue;
      console.log(`  ${k.padEnd(20)} ${v1} → ${v2} ${pct(v1, v2)}`);
    }
  }
}
