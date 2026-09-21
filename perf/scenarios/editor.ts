import { MARK } from "../../src/lib/perfMarks";
import type { Scenario } from "../scenario";

const STATEMENTS = 300;
const TYPED = "\nSELECT o.orderkey FROM tpch.sf1.orders o;";

function bigFile(): string {
  const parts: string[] = [];
  for (let i = 0; i < STATEMENTS; i++) {
    parts.push(
      `SELECT
  o.orderkey,
  o.custkey,
  o.orderstatus,
  o.totalprice,
  o.orderdate,
  o.orderpriority,
  o.clerk
FROM tpch.sf1.orders o
WHERE o.orderkey = ${i * 7 + 1}
  AND o.totalprice > ${i};
`
    );
  }
  return parts.join("\n");
}

/**
 * A few thousand lines of statements, then a statement typed at the end one
 * key at a time: parse, split, toolbar re-anchoring and completion all sit on
 * that path, and the file is big enough that anything proportional to its
 * length shows up per key.
 */
export const editor: Scenario = {
  name: "editor",
  description: `type a statement at the end of a ${STATEMENTS}-statement file; main-thread ms per key`,
  async run(s) {
    await s.phase("open", () => s.open(bigFile()));
    await s.focusEditor();
    await s.page.keyboard.down("Control");
    await s.page.keyboard.press("End");
    await s.page.keyboard.up("Control");
    await s.sleep(500);
    const before = await s.markCount(MARK.editorChange);
    await s.phase("type", async () => {
      await s.page.keyboard.type(TYPED, { delay: 60 });
      await s.page.keyboard.press("Escape");
      await s.sleep(1500);
    });
    const edits = (await s.markCount(MARK.editorChange)) - before;
    const lines = await s.page.evaluate(() => document.querySelectorAll(".view-line").length);
    return (trace) => {
      const type = trace.phase("type");
      const open = trace.phase("open");
      return {
        metrics: {
          statements: STATEMENTS,
          keys: TYPED.length,
          edits,
          msPerKey: Math.round((type.mainMs / TYPED.length) * 10) / 10,
          scriptMsPerKey: Math.round((type.byCategory.script / TYPED.length) * 10) / 10,
          openMainMs: Math.round(open.mainMs),
          visibleLines: lines
        },
        checks: {
          "every key was an edit": edits >= TYPED.length,
          "no key costs a long task": type.longTasks.length === 0
        }
      };
    };
  }
};
