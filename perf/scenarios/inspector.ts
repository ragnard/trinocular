import { MARK } from "../../src/lib/perfMarks";
import type { Scenario } from "../scenario";

const ROWS = 200;

/**
 * A 200-row selection, all columns, into the unvirtualised inspector: from
 * the shift-click to the pane having drawn every document. Flat rows and
 * nested ones (row, array, map) are separate scenarios, since `flatten` is
 * where the nested cost lives.
 */
function inspector(name: string, description: string, sql: string): Scenario {
  return {
    name,
    description,
    async run(s) {
      await s.phase("open", () => s.open(sql));
      await s.phase("run", () => s.runStatement());
      const before = await s.markCount(MARK.inspectorRendered);
      await s.page.click(`tr[data-row-index="0"] td.row-num`);
      await s.page.$eval(".table-container", (el, top) => (el.scrollTop = top), (ROWS - 5) * 30);
      await s.sleep(200);
      await s.page.keyboard.down("Shift");
      await s.phase("select", async () => {
        await s.page.click(`tr[data-row-index="${ROWS - 1}"] td.row-num`);
        await s.page.keyboard.up("Shift");
        await s.page.waitForFunction(
          (n: string, c: number, docs: number) => {
            const entries = performance.getEntriesByName(n) as PerformanceMark[];
            return entries.length > c && entries.at(-1)!.detail?.documents === docs;
          },
          { timeout: 120_000, polling: 50 },
          MARK.inspectorRendered,
          before,
          ROWS
        );
      });
      const rendered = await s.lastMark(MARK.inspectorRendered);
      const fields = (rendered?.detail as { fields: number })?.fields ?? 0;
      const nodes = (await s.metrics()).Nodes;
      return (trace) => {
        const select = trace.phase("select");
        return {
          metrics: {
            documents: ROWS,
            fieldsPerDocument: fields,
            selectToRenderedMs: Math.round(select.wallMs),
            mainMs: Math.round(select.mainMs),
            domNodes: nodes
          },
          checks: {
            "no task over 500ms": select.longTasks.every((t) => t.durMs < 500)
          }
        };
      };
    }
  };
}

export const inspectorFlat = inspector(
  "inspector-flat",
  "select 200 flat rows; ms until the inspector has drawn them",
  "SELECT * FROM tpch.sf1.orders LIMIT 1000"
);

export const inspectorNested = inspector(
  "inspector-nested",
  "select 200 rows of row/array/map values; ms until the inspector has drawn them",
  `SELECT
  o.orderkey,
  CAST(ROW(o.custkey, o.orderstatus, o.totalprice) AS ROW(custkey bigint, status varchar, total double)) AS r,
  ARRAY[o.totalprice, o.totalprice * 2, o.totalprice * 3] AS a,
  MAP(ARRAY['priority', 'clerk', 'comment'], ARRAY[o.orderpriority, o.clerk, o.comment]) AS m,
  ARRAY[CAST(ROW(o.orderkey, o.orderdate) AS ROW(k bigint, d date))] AS ar
FROM tpch.sf1.orders o
LIMIT 1000`
);
