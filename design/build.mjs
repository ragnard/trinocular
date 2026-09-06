// Assembles the .dc.html artboards from the shared preamble + per-artboard body.
// Run: node build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const pre = readFileSync("_pre.part", "utf8");
const TAIL = "\n</x-dc>\n</body>\n</html>\n";

// Column names deliberately long against short values — the case the stacked
// name-over-type header exists for.
const COLS = [
  { n: "nation", t: "varchar(25)" },
  { n: "orders", t: "bigint", r: true },
  { n: "distinct_customers", t: "bigint", r: true },
  { n: "revenue", t: "double", r: true },
  { n: "avg_days_order_to_ship", t: "double", r: true }
];

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
  ["JAPAN", "600774", "60002", "9074116220.85", "7.50"],
  ["JORDAN", "599210", "60041", "9051447903.64", "7.53"],
  ["KENYA", "600550", "59918", "9069220774.19", "7.48"],
  ["MOROCCO", "599402", "60155", "9053118447.02", "7.51"],
  ["MOZAMBIQUE", "601011", "60003", "9081447220.36", "7.49"]
];

const S1 = "background:var(--s1);border-bottom:1px solid var(--line-strong)";

// Header stays two lines: the name over its type. A column is often named far
// wider than anything in it, and stacking buys those characters back without
// paying for them in table width.
function header(widths, { rowNum = 52 } = {}) {
  const cells = COLS.map(({ n, t }, i) => {
    return (
      `<th style="width:${widths[i]}px;${S1};border-right:1px solid var(--line);padding:0 12px;text-align:left;vertical-align:middle">` +
      `<div class="ell" style="font-size:13px;line-height:17px" title="${n}">${n}</div>` +
      `<div class="ell meta" style="color:var(--fg-3);line-height:14px">${t}</div>` +
      `</th>`
    );
  }).join("");
  return (
    `<tr style="height:36px">` +
    `<th style="width:${rowNum}px;${S1};border-right:1px solid var(--line)"></th>` +
    cells +
    `<th style="${S1}"></th>` +
    `</tr>`
  );
}

// Body: horizontal hairlines only, numerics right-aligned and tabular.
function rows({ count = 12, selected = 2, selectedCols = [3] } = {}) {
  const h = 30;
  return DATA.slice(0, count)
    .map((values, i) => {
      const cells = values
        .map((v, c) => {
          const align = COLS[c].r ? "right" : "left";
          const sel = i === selected && selectedCols.includes(c);
          return (
            `<td style="height:${h}px;padding:0 12px;border-bottom:1px solid var(--line);text-align:${align}` +
            (COLS[c].r ? ";font-variant-numeric:tabular-nums" : "") +
            (sel ? ";background:var(--accent-bg);box-shadow:inset 0 0 0 1px var(--accent-line)" : "") +
            `">${v}</td>`
          );
        })
        .join("");
      return (
        `<tr>` +
        `<td class="meta num" style="height:${h}px;padding:0 12px;text-align:right;color:var(--fg-3);background:var(--s1);border-right:1px solid var(--line);border-bottom:1px solid var(--line)">${i + 1}</td>` +
        cells +
        `<td style="border-bottom:1px solid var(--line)"></td>` +
        `</tr>`
      );
    })
    .join("\n");
}

// A block selection: three rows deep, three columns wide.
function rowsBlock({ count = 12, rowsSel = [2, 3, 4], colsSel = [0, 2, 3] } = {}) {
  const h = 30;
  return DATA.slice(0, count)
    .map((values, i) => {
      const inRows = rowsSel.includes(i);
      const cells = values
        .map((v, c) => {
          const align = COLS[c].r ? "right" : "left";
          const sel = inRows && colsSel.includes(c);
          const active = sel && i === rowsSel[0] && c === colsSel[0];
          return (
            `<td style="height:${h}px;padding:0 12px;border-bottom:1px solid var(--line);text-align:${align}` +
            (COLS[c].r ? ";font-variant-numeric:tabular-nums" : "") +
            (sel ? ";background:var(--accent-bg)" : "") +
            (active ? ";box-shadow:inset 0 0 0 1px var(--accent-line)" : "") +
            `">${v}</td>`
          );
        })
        .join("");
      return (
        `<tr>` +
        `<td class="meta num" style="height:${h}px;padding:0 12px;text-align:right;color:${inRows ? "var(--accent)" : "var(--fg-3)"};background:${inRows ? "var(--accent-bg)" : "var(--s1)"};border-right:1px solid var(--line);border-bottom:1px solid var(--line)">${i + 1}</td>` +
        cells +
        `<td style="border-bottom:1px solid var(--line)"></td>` +
        `</tr>`
      );
    })
    .join("\n");
}

const build = (name, bodyFile, replacements = {}) => {
  let body = readFileSync(bodyFile, "utf8");
  for (const [k, v] of Object.entries(replacements)) body = body.split(k).join(v);
  writeFileSync(name, pre + body + TAIL);
  console.log("wrote", name, (pre + body + TAIL).length, "bytes");
};

const NARROW = [150, 100, 115, 150, 140];
const WIDE = [200, 130, 150, 190, 175];

build("Current.dc.html", "_body_current.part");
build("Main.dc.html", "_body_main.part", {
  "<!--HEADER-->": header(NARROW),
  "<!--ROWS-->": rowsBlock({ count: 12, rowsSel: [2, 3, 4], colsSel: [0, 1, 2, 3] })
});
build("Cards.dc.html", "_body_cards.part", {
  "<!--HEADER-->": header(NARROW),
  "<!--ROWS-->": rowsBlock({ count: 14, rowsSel: [2, 3, 4, 5, 6], colsSel: [0, 1, 2, 3] })
});
build("AppBar.dc.html", "_body_appbar.part", {
  "<!--HEADER-->": header(WIDE),
  "<!--ROWS-->": rows({ count: 15 })
});
build("Inspector.dc.html", "_body_inspector.part", {
  "<!--HEADER-->": header(NARROW),
  "<!--ROWS4-->": rows({ count: 4, selected: -1 }),
  "<!--ROWS1-->": rows({ count: 6, selected: 2, selectedCols: [3] }),
});
build("System.dc.html", "_body_system.part");
