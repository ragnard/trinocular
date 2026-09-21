import type { Scenario } from "../scenario";
import type { Session } from "../session";

const STEPS = 40;

/** Every column of seven tpch tables at once: 56 fields a row, which is the
 *  kind of result the full window exists for. */
const SQL = `SELECT l.*, o.*, c.*, p.*, s.*, n.*, r.*
FROM tpch.sf1.lineitem l
JOIN tpch.sf1.orders o ON o.orderkey = l.orderkey
JOIN tpch.sf1.customer c ON c.custkey = o.custkey
JOIN tpch.sf1.part p ON p.partkey = l.partkey
JOIN tpch.sf1.supplier s ON s.suppkey = l.suppkey
JOIN tpch.sf1.nation n ON n.nationkey = c.nationkey
JOIN tpch.sf1.region r ON r.regionkey = n.regionkey
LIMIT 1000`;

/** Waits until the dialog's rail says it is on `row` — the visible truth,
 *  rather than a count of render marks, of which a step produces two. */
async function waitForDialogRow(s: Session, row: number, timeoutMs: number): Promise<void> {
  await s.page.waitForFunction(
    (n: number) => {
      const text = document.querySelector("dialog[open] .inspector .rail span")?.textContent ?? "";
      return Number(/Row ([\d,]+)/.exec(text)?.[1]?.replaceAll(",", "") ?? 0) === n;
    },
    { timeout: timeoutMs, polling: 20 },
    row
  );
}

/**
 * The full-window inspector over a wide result: `Enter` on a cell opens it,
 * `↓` steps it through the rows, `Escape` closes it. A step is one row drawn
 * twice — the dialog and the pane behind it read the same selection — plus
 * the table scrolling the row into view behind the scrim, so it is the
 * scenario for anything on the selection → inspector path that is not
 * `flatten` (which `inspector-*` already isolates). The close is measured
 * too, since it tears down a document and hands focus back to the grid.
 */
export const record: Scenario = {
  name: "record",
  description: `open the full-window inspector on a 56-column row, step ${STEPS} rows, close it`,
  async run(s) {
    await s.phase("open", () => s.open(SQL));
    await s.phase("run", () => s.runStatement());
    await s.page.click(`tr[data-row-index="0"] td:not(.row-num)`);
    await s.phase("expand", async () => {
      await s.page.keyboard.press("Enter");
      await waitForDialogRow(s, 1, 30_000);
    });
    const fields = await s.page.$$eval("dialog[open] .inspector .field", (els) => els.length);
    const nodes = await s.page.$eval("dialog[open]", (el) => el.querySelectorAll("*").length);
    let drawn = 0;
    await s.phase("step", async () => {
      for (let i = 1; i <= STEPS; i++) {
        await s.page.keyboard.press("ArrowDown");
        await waitForDialogRow(s, i + 1, 10_000);
        drawn++;
      }
    });
    await s.phase("close", async () => {
      await s.page.keyboard.press("Escape");
      await s.page.waitForFunction(() => !document.querySelector("dialog"), {
        timeout: 10_000,
        polling: 20
      });
    });
    const after = await s.page.evaluate(() => ({
      focused: document.activeElement?.classList.contains("table-container") ?? false,
      selectedRow: Number(document.querySelector("td.row-num.selected")?.textContent ?? 0)
    }));
    return (trace) => {
      const expand = trace.phase("expand");
      const step = trace.phase("step");
      const close = trace.phase("close");
      return {
        metrics: {
          fields,
          dialogDomNodes: nodes,
          expandMainMs: Math.round(expand.mainMs),
          steps: STEPS,
          msPerStep: Math.round((step.mainMs / STEPS) * 10) / 10,
          scriptMsPerStep: Math.round((step.byCategory.script / STEPS) * 10) / 10,
          layoutMsPerStep: Math.round((step.byCategory.layout / STEPS) * 10) / 10,
          closeMainMs: Math.round(close.mainMs)
        },
        checks: {
          "every step drew its row": drawn === STEPS,
          "no step costs a long task": step.longTasks.length === 0,
          "no task over 500ms opening or closing": [...expand.longTasks, ...close.longTasks].every(
            (t) => t.durMs < 500
          ),
          "closing leaves the grid focused on the stepped row":
            after.focused && after.selectedRow === STEPS + 1
        }
      };
    };
  }
};
