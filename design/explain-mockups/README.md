# EXPLAIN visualizer — mockups

Design mockups for an `EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON)` view in the results pane.
Not code — these are static artboards, published as a Claude Design canvas.

Every artboard renders the example from
<https://trino.io/docs/current/sql/explain.html#explain-type-distributed-format-json>
(`SELECT regionkey, count(*) FROM nation GROUP BY 1`) with its real node ids, descriptors,
details and estimates. Chrome is lifted from the real components: `src/style.css` tokens
(resolved from their `oklch(from …)` form to hex), the `trino-dark` monaco theme, the 18px
statement toolbar band from `Editor.svelte`, and `DataViewer.svelte`'s field/value table.

| Artboard | What it shows |
| --- | --- |
| `Main.dc.html` | The whole IDE at 1440×900 with option A in the results pane |
| `DirectionA.dc.html` | Option A — fragments as cards, dataflow left to right |
| `DirectionB.dc.html` | Option B — one continuous plan tree, fragments spliced at the RemoteSource |
| `DirectionC.dc.html` | Option C — every node as a cardinality bar |
| `JsonView.dc.html` | The raw JSON tab |
| `LightTheme.dc.html` | Option A against the light palette |
| `Inspector.dc.html` | Node detail in the existing right-hand pane |
| `Toolbar.dc.html` | Statement toolbar states with the new `Explain` action |

`canvas.json` lays them out and carries the sticky notes.

## Re-seeding

The published page is assembled from these files; the seeded `.html` is a build output and is
not checked in. To rebuild it after editing an artboard, run the `design` skill's helper:

```bash
node "<design skill base dir>/seed-canvas.mjs" \
  --template "<design skill base dir>/payload.template.html" \
  --out trino-explain-visualizer.html \
  --title "Trino Explain Visualizer" \
  --artboard Main.dc.html --artboard DirectionA.dc.html --artboard DirectionB.dc.html \
  --artboard DirectionC.dc.html --artboard JsonView.dc.html --artboard LightTheme.dc.html \
  --artboard Inspector.dc.html --artboard Toolbar.dc.html \
  --canvas canvas.json
```

then republish that file to the same artifact URL.
