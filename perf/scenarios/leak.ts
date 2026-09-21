import type { Outcome, Scenario } from "../scenario";

const ITERATIONS = 10;

/**
 * The same statement run over and over: each re-run replaces the result and
 * the old one is discarded, so the heap should plateau after warm-up rather
 * than climb. Then the statement is erased, which drops the result, and the
 * heap should come down.
 *
 * Only the production build can pass: Svelte's dev runtime (5.55) keeps every
 * source that was in a batch in a module-level `source_stacks` set that its
 * `flush()` shadows instead of clearing, so under `vite dev` each run retains
 * its predecessor. Against a dev server the numbers are printed and the
 * checks are not made.
 */
export const leak: Scenario = {
  name: "leak",
  description: "re-run a 100k-row statement 10 times; heap should plateau, then drop when erased",
  async run(s) {
    await s.phase("open", () => s.open("SELECT * FROM tpch.sf1.orders LIMIT 100000"));
    await s.setLimit(100000);
    const heap: number[] = [];
    await s.phase("loop", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        await s.runStatement();
        heap.push(await s.heapMb());
      }
    });
    await s.focusEditor();
    await s.page.keyboard.down("Control");
    await s.page.keyboard.press("a");
    await s.page.keyboard.up("Control");
    await s.page.keyboard.press("Delete");
    await s.page.waitForFunction(() => !document.querySelector(".table-container"), {
      timeout: 30_000
    });
    const afterErase = await s.heapMb();
    const dev = await s.isDev();
    const early = heap.slice(1, 4).reduce((a, b) => a + b, 0) / 3;
    const late = heap.slice(-3).reduce((a, b) => a + b, 0) / 3;
    return (trace): Outcome => {
      const loop = trace.phase("loop");
      return {
        metrics: {
          iterations: ITERATIONS,
          heapMbSeries: heap.join(" "),
          heapMbEarly: Math.round(early * 10) / 10,
          heapMbLate: Math.round(late * 10) / 10,
          heapMbAfterErase: afterErase,
          majorGcs: loop.counts.majorGc,
          ...(dev
            ? { note: "dev server: Svelte's dev runtime retains results, checks skipped" }
            : {})
        },
        checks: dev
          ? {}
          : {
              "heap plateaus across re-runs": late < early * 1.25 + 5,
              "erasing the statement releases the result": afterErase < late * 0.6
            }
      };
    };
  }
};
