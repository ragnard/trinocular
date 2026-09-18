import type { Scenario } from "../scenario";

const TYPED = "store_sales";

/**
 * The schema browser's filter over a tree that has been expanded a fair way:
 * per-keystroke cost, and the rule from CLAUDE.md that nothing on the
 * keystroke path reaches the cluster, read straight off the trace's requests.
 */
export const filter: Scenario = {
  name: "filter",
  description: "type into the schema filter over an expanded tpcds tree; ms per key, zero requests",
  async run(s) {
    await s.phase("open", () => s.open("SELECT 1"));
    await s.phase("expand", async () => {
      await s.clickTreeNode("tpcds");
      for (const schema of ["sf1", "sf10", "sf100", "sf1000"]) await s.clickTreeNode(schema);
      for (const table of ["store_sales", "catalog_sales", "web_sales", "customer", "item"]) {
        await s.clickTreeNode(table);
      }
    });
    const nodes = await s.page.$$eval(".tree button.label", (els) => els.length);
    await s.page.click('input[aria-label="Filter schema"]');
    await s.phase("filter", async () => {
      await s.page.keyboard.type(TYPED, { delay: 80 });
      await s.sleep(500);
    });
    const shown = await s.page.$$eval(".tree button.label", (els) => els.length);
    return (trace) => {
      const f = trace.phase("filter");
      return {
        metrics: {
          treeNodes: nodes,
          nodesShown: shown,
          keys: TYPED.length,
          msPerKey: Math.round((f.mainMs / TYPED.length) * 10) / 10,
          apiRequests: f.apiRequests
        },
        checks: {
          "no request on the keystroke path": f.apiRequests === 0,
          "no key costs a long task": f.longTasks.length === 0
        }
      };
    };
  }
};
