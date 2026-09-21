/**
 * Reads a Chromium trace (`{traceEvents}`, the file the DevTools Performance
 * panel loads) into per-phase numbers. Only the renderer's main thread is
 * read: it is the thread carrying the `perf:` user-timing marks the session
 * wrote. Complete events (`ph: "X"`) on one thread nest, so an event's self
 * time is its duration minus its children's, which is what keeps the
 * categories from double-counting a layout forced inside a function call.
 */

export interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: Record<string, any>;
}

export type Category = "script" | "style" | "layout" | "paint" | "gc" | "parse" | "other";
export const CATEGORIES: Category[] = [
  "script",
  "style",
  "layout",
  "paint",
  "gc",
  "parse",
  "other"
];

export interface LongTask {
  atMs: number;
  durMs: number;
  /** The heaviest function call inside it, if the trace says. */
  top?: string;
}

export interface PhaseSummary {
  name: string;
  wallMs: number;
  mainMs: number;
  byCategory: Record<Category, number>;
  counts: { layout: number; style: number; minorGc: number; majorGc: number; tasks: number };
  longTasks: LongTask[];
  apiRequests: number;
}

function categoryOf(name: string): Category {
  if (name === "Layout") return "layout";
  if (name === "UpdateLayoutTree" || name === "ScheduleStyleRecalculation") return "style";
  if (/^(Paint|PrePaint|Layerize|Commit|CompositeLayers|UpdateLayer|Draw)/.test(name))
    return "paint";
  if (/^(V8\.GC|MinorGC|MajorGC|BlinkGC|CppGC)/.test(name)) return "gc";
  if (/^(ParseHTML|ParseAuthorStyleSheet|v8\.parse|V8\.Parse|v8\.compile|V8\.Compile)/.test(name))
    return "parse";
  if (
    /^(FunctionCall|EvaluateScript|EvaluateModule|RunMicrotasks|TimerFire|EventDispatch|FireAnimationFrame|XHRReadyStateChange|v8\.|V8\.|ProfileCall)/.test(
      name
    )
  )
    return "script";
  return "other";
}

const short = (url: string) =>
  url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\?.*$/, "")
    .replace(/^\/node_modules\/\.vite\/deps\//, "deps/")
    .replace(/^\/@fs\/.*\/packages\//, "packages/")
    .replace(/^\/src\//, "");

export class Trace {
  private readonly main: TraceEvent[];
  private readonly xs: (TraceEvent & { dur: number; self: number })[];
  private readonly marks: Map<string, number[]>;

  constructor(events: TraceEvent[]) {
    const anchor = events.find((e) => e.cat === "blink.user_timing" && e.name.startsWith("perf:"));
    if (!anchor) throw new Error("Trace carries no perf: marks");
    this.main = events.filter((e) => e.pid === anchor.pid && e.tid === anchor.tid);
    this.marks = new Map();
    for (const e of this.main) {
      if (e.cat !== "blink.user_timing") continue;
      const list = this.marks.get(e.name) ?? [];
      list.push(e.ts);
      this.marks.set(e.name, list);
    }
    const xs = this.main
      .filter((e): e is TraceEvent & { dur: number } => e.ph === "X" && e.dur != null)
      .sort((a, b) => a.ts - b.ts || b.dur - a.dur)
      .map((e) => ({ ...e, self: e.dur }));
    const stack: typeof xs = [];
    for (const e of xs) {
      while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      if (parent) parent.self -= e.dur;
      stack.push(e);
    }
    this.xs = xs;
  }

  static async load(path: string): Promise<Trace> {
    const { traceEvents } = await Bun.file(path).json();
    return new Trace(traceEvents);
  }

  /** Timestamps (trace µs) of every mark of that name. */
  markTimes(name: string): number[] {
    return this.marks.get(name) ?? [];
  }

  phaseWindow(name: string): [number, number] {
    const a = this.markTimes(`perf:${name}:start`)[0];
    const b = this.markTimes(`perf:${name}:end`).at(-1);
    if (a == null || b == null) throw new Error(`Phase ${name} has no start/end marks`);
    return [a, b];
  }

  /** Main-thread self time, in ms, of everything inside [a, b] (trace µs). */
  mainMs(a: number, b: number): number {
    let sum = 0;
    for (const e of this.xs) if (e.ts >= a && e.ts <= b) sum += e.self;
    return sum / 1000;
  }

  count(name: string, a: number, b: number): number {
    let n = 0;
    for (const e of this.main) if (e.name === name && e.ts >= a && e.ts <= b) n++;
    return n;
  }

  /** Requests the page sent in the window, to `/api/` unless told otherwise. */
  requests(a: number, b: number, match: RegExp = /\/api\//): number {
    let n = 0;
    for (const e of this.main) {
      if (e.name !== "ResourceSendRequest" || e.ts < a || e.ts > b) continue;
      if (match.test(e.args?.data?.url ?? "")) n++;
    }
    return n;
  }

  phase(name: string): PhaseSummary {
    const [a, b] = this.phaseWindow(name);
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
      Category,
      number
    >;
    let tasks = 0;
    const longTasks: LongTask[] = [];
    for (const e of this.xs) {
      if (e.ts < a || e.ts > b) continue;
      byCategory[categoryOf(e.name)] += e.self / 1000;
      if (e.name !== "RunTask") continue;
      tasks++;
      if (e.dur > 50_000) {
        const inside = this.xs.filter(
          (f) => f !== e && f.ts >= e.ts && f.ts + f.dur <= e.ts + e.dur
        );
        const call = inside
          .filter((f) => f.name === "FunctionCall")
          .sort((x, y) => y.dur - x.dur)[0];
        const d = call?.args?.data;
        const heaviest = inside.sort((x, y) => y.self - x.self)[0];
        longTasks.push({
          atMs: Math.round((e.ts - a) / 1000),
          durMs: Math.round(e.dur / 1000),
          top: d
            ? `${d.functionName || "(anonymous)"} ${short(d.url ?? "")}:${d.lineNumber} (${Math.round(call.dur / 1000)}ms)`
            : heaviest
              ? `${heaviest.name} ${Math.round(heaviest.self / 1000)}ms`
              : undefined
        });
      }
    }
    return {
      name,
      wallMs: (b - a) / 1000,
      mainMs: this.mainMs(a, b),
      byCategory,
      counts: {
        layout: this.count("Layout", a, b),
        style: this.count("UpdateLayoutTree", a, b),
        minorGc: this.count("MinorGC", a, b),
        majorGc: this.count("MajorGC", a, b),
        tasks
      },
      longTasks: longTasks.sort((x, y) => y.durMs - x.durMs).slice(0, 5),
      apiRequests: this.requests(a, b)
    };
  }
}
