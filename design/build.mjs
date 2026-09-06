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

// The inspector's stack: one document per selected row, fields flattened.
function docs({ rowsSel = [2, 3, 4], colsSel = [0, 1, 2, 3], keyWidth = 150 } = {}) {
  return rowsSel
    .map((r, n) => {
      const head =
        `<div class="row" style="gap:8px;height:24px;padding:0 12px;background:var(--s2);` +
        (n === 0 ? "border-top:1px solid var(--line);" : "") +
        `border-bottom:1px solid var(--line)"><span class="caps" style="color:var(--fg-2)">Row ${r + 1}</span>` +
        `<span style="flex:1"></span><span class="row" style="color:var(--fg-3)"><svg class="ic12"><use href="#i-copy"/></svg></span></div>`;
      const fields = colsSel
        .map(
          (c) =>
            `<div style="display:grid;grid-template-columns:${keyWidth}px minmax(0,1fr);gap:0 10px;padding:6px 12px;border-bottom:1px solid var(--line)">` +
            `<span class="ell" style="color:var(--fg-2)">${COLS[c].n}</span>` +
            `<span class="mono ell">${DATA[r][c]}</span></div>`
        )
        .join("\n");
      return head + "\n" + fields;
    })
    .join("\n");
}

// ---- Iceberg snapshot history, for the table-inspection document ----------
const SNAP_COLS = [
  { n: "committed_at", t: "timestamp(6) with time zone", w: 140 },
  { n: "snapshot_id", t: "bigint", w: 160, r: true },
  { n: "operation", t: "varchar", w: 90 },
  { n: "added_records", t: "bigint", w: 110, r: true },
  { n: "summary", t: "map(varchar, varchar)", w: 160 }
];

const SNAPS = [
  ["2026-08-30 04:12:07", "7286302847263048192", "append", "1284119"],
  ["2026-08-29 04:11:52", "6104772819930014772", "append", "1279044"],
  ["2026-08-28 04:12:19", "5518830472019477310", "append", "1281907"],
  ["2026-08-27 11:48:02", "4471003918827740165", "overwrite", "88214"],
  ["2026-08-27 04:12:11", "3920184471028837744", "append", "1277330"],
  ["2026-08-26 04:11:47", "8817204471930028174", "append", "1283006"],
  ["2026-08-25 04:12:33", "2204718839017744820", "append", "1276448"],
  ["2026-08-24 22:03:16", "9018374471029948173", "delete", "0"],
  ["2026-08-24 04:12:04", "1174829930184477201", "append", "1280771"],
  ["2026-08-23 04:11:58", "7744019283710046628", "append", "1278115"],
  ["2026-08-22 04:12:22", "3310472819944017283", "append", "1284902"],
  ["2026-08-21 15:27:41", "6628193047718820114", "replace", "0"],
  ["2026-08-21 04:12:09", "5019283744710028846", "append", "1279663"],
  ["2026-08-20 04:11:51", "8471920038174472019", "append", "1281204"],
  ["2026-08-19 04:12:15", "2938471002847719330", "append", "1277889"],
  ["2026-08-18 04:12:02", "4710283391847720046", "append", "1283441"],
  ["2026-08-17 04:11:44", "1028374471992018837", "append", "1276092"],
  ["2026-08-16 04:12:28", "6193047710288472013", "append", "1282517"]
];

const SNAP_SUMMARY = "{added-data-files=41, added-records=1284119, \u2026}";

function snapHeader() {
  const cells = SNAP_COLS.map(
    ({ n, t, w }) =>
      `<th style="width:${w}px;${S1};border-right:1px solid var(--line);padding:0 12px;text-align:left;vertical-align:middle">` +
      `<div class="ell" style="font-size:13px;line-height:17px">${n}</div>` +
      `<div class="ell meta" style="color:var(--fg-3);line-height:14px">${t}</div></th>`
  ).join("");
  return (
    `<tr style="height:36px"><th style="width:52px;${S1};border-right:1px solid var(--line)"></th>` +
    cells +
    `<th style="${S1}"></th></tr>`
  );
}

function snapRows({ count = 18, rowsSel = [0, 1] } = {}) {
  return SNAPS.slice(0, count)
    .map((v, i) => {
      const values = [...v, SNAP_SUMMARY];
      const sel = rowsSel.includes(i);
      const cells = values
        .map((val, c) => {
          const right = SNAP_COLS[c].r;
          return (
            `<td class="ell${right ? " num" : ""}${c === 1 || c === 4 ? " mono" : ""}" style="height:30px;padding:0 12px;border-bottom:1px solid var(--line);text-align:${right ? "right" : "left"}` +
            (sel ? ";background:var(--accent-bg)" : "") +
            (sel && i === rowsSel[0] && c === 0 ? ";box-shadow:inset 0 0 0 1px var(--accent-line)" : "") +
            (!sel && c === 4 ? ";color:var(--fg-2)" : "") +
            `">${val}</td>`
          );
        })
        .join("");
      return (
        `<tr><td class="meta num" style="height:30px;padding:0 12px;text-align:right;color:${sel ? "var(--accent)" : "var(--fg-3)"};background:${sel ? "var(--accent-bg)" : "var(--s1)"};border-right:1px solid var(--line);border-bottom:1px solid var(--line)">${i + 1}</td>` +
        cells +
        `<td style="border-bottom:1px solid var(--line)"></td></tr>`
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
  "<!--ROWS-->": rowsBlock({ count: 12, rowsSel: [2, 3, 4, 5, 6], colsSel: [0, 1, 2, 3] }),
  "<!--DOCS-->": docs({ rowsSel: [2, 3, 4, 5, 6], colsSel: [0, 1, 2, 3] })
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
build("TableDoc.dc.html", "_body_tabledoc.part", {
  "<!--SNAPHEADER-->": snapHeader(),
  "<!--SNAPROWS-->": snapRows({ count: 18, rowsSel: [0, 1] })
});
build("Documents.dc.html", "_body_documents.part");
build("System.dc.html", "_body_system.part");
