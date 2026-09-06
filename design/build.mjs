// Assembles the .dc.html artboards from the shared preamble + per-artboard body.
// Run: node build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const pre = readFileSync("_pre.part", "utf8");
const TAIL = "\n</x-dc>\n</body>\n</html>\n";

const DATA = [
  ["ARGENTINA", "598412", "59927", "9048217445.31", "7.51"],
  ["BRAZIL", "601077", "60011", "9087445021.08", "7.49"],
  ["CANADA", "600288", "59988", "9070154776.62", "7.52"],
  ["CHINA", "599940", "60104", "9065000021.14", "7.48"],
  ["EGYPT", "600116", "59882", "9059116774.02", "7.53"],
  ["ETHIOPIA", "598850", "59771", "9042771010.55", "7.50"],
  ["FRANCE", "600464", "60220", "9072458991.37", "7.47"],
  ["GERMANY", "601300", "60315", "9088010447.90", "7.51"],
  ["INDIA", "600002", "59904", "9061004118.73", "7.55"],
  ["INDONESIA", "599731", "60077", "9056999210.47", "7.49"],
  ["IRAN", "598104", "59810", "9037811006.29", "7.52"],
  ["IRAQ", "600899", "60188", "9077001552.11", "7.46"],
  ["JAPAN", "600774", "60002", "9074116220.85", "7.50"]
];

// Proposed table: horizontal hairlines only, numerics right-aligned + tabular.
function rows({ h = 30, selected = 2, widths = [200, 130, 140, 190, 150] }) {
  return DATA.map(([nation, orders, customers, revenue, days], i) => {
    const cell = (v, align, sel) =>
      `<td style="height:${h}px;padding:0 10px;border-bottom:1px solid var(--line);text-align:${align}` +
      (align === "right" ? ";font-variant-numeric:tabular-nums" : "") +
      (sel ? ";background:var(--accent-bg);box-shadow:inset 0 0 0 1px var(--accent-line)" : "") +
      `">${v}</td>`;
    return (
      `<tr>` +
      `<td class="meta num" style="height:${h}px;padding:0 10px;text-align:right;color:var(--fg-3);background:var(--s1);border-right:1px solid var(--line);border-bottom:1px solid var(--line)">${i + 1}</td>` +
      cell(nation, "left", false) +
      cell(orders, "right", false) +
      cell(customers, "right", false) +
      cell(revenue, "right", i === selected) +
      cell(days, "right", false) +
      `<td style="border-bottom:1px solid var(--line)"></td>` +
      `</tr>`
    );
  }).join("\n");
}

const build = (name, bodyFile, replacements = {}) => {
  let body = readFileSync(bodyFile, "utf8");
  for (const [k, v] of Object.entries(replacements)) body = body.split(k).join(v);
  writeFileSync(name, pre + body + TAIL);
  console.log("wrote", name, (pre + body + TAIL).length, "bytes");
};

build("Current.dc.html", "_body_current.part");
build("Main.dc.html", "_body_main.part", { "<!--ROWS-->": rows({}) });
build("Cards.dc.html", "_body_cards.part", { "<!--ROWS-->": rows({ h: 32, selected: 2, widths: [] }) });
build("AppBar.dc.html", "_body_appbar.part", { "<!--ROWS-->": rows({ h: 32, selected: 2 }) });
build("Inspector.dc.html", "_body_inspector.part");
build("System.dc.html", "_body_system.part");
