import { MARK } from "../../src/lib/perfMarks";
import type { Scenario } from "../scenario";

/**
 * Half a million narrow rows over many pages, with the cap off: the cost of
 * a page arriving is the reactive re-render that follows `Rows.append`, so
 * what is read is main-thread ms per page across the run.
 */
export const append: Scenario = {
  name: "append",
  description: "stream 500k rows into a result; main-thread ms per page",
  async run(s) {
    await s.phase("open", () => s.open("SELECT * FROM tpch.sf1.orders LIMIT 500000"));
    await s.setLimit(null);
    await s.phase("run", () => s.runStatement());
    const settled = await s.lastMark(MARK.resultSettled);
    const rows = (settled?.detail as { rows: number })?.rows ?? 0;
    const heapMb = await s.heapMb();
    return (trace) => {
      const run = trace.phase("run");
      const [a, b] = trace.phaseWindow("run");
      const pages = trace.markTimes(MARK.resultPage).filter((t) => t >= a && t <= b).length;
      return {
        metrics: {
          rows,
          pages,
          msPerPage: Math.round((run.mainMs / Math.max(1, pages)) * 10) / 10,
          scriptMsPerPage: Math.round((run.byCategory.script / Math.max(1, pages)) * 10) / 10,
          layoutsPerPage: Math.round((run.counts.layout / Math.max(1, pages)) * 10) / 10,
          heapMb
        },
        checks: {
          "no task over 50ms while pages arrive": run.longTasks.length === 0
        }
      };
    };
  }
};
