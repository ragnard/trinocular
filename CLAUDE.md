# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Trinette?

A web-based SQL query IDE for the Trino distributed query engine. Users write SQL in a Monaco editor, execute queries against Trino clusters via a server-side proxy, and browse results in a virtualized table with a detail inspector.

## Commands

```bash
bun install              # Install dependencies (bun workspaces; packages/* are symlinked)
bun run dev              # Dev server on port 5173
bun run build            # Production build (SvelteKit node adapter)
bun run check            # Type-check with svelte-check
bun run preview          # Preview production build
```

No test framework is configured.

## Architecture

### Client-side data flow

```
Monaco Editor → runStatement() → Trino client (fetch, one per run) → server proxy → Trino cluster
                                          ↓
                              Result (State.svelte.ts)
                              accumulates chunks into $state.raw fields
                                          ↓
                              Result.svelte → Table.svelte (virtual scroll)
                                                ↓ (Selection: rect + lazy getData)
                                          DataViewer.svelte (debounced)
```

- **State management**: Svelte 5 runes on class instances (`Workspace`, `SqlFile`, `Result` in `src/lib/State.svelte.ts`). `Result` fields use `$state.raw()` to avoid deep proxy overhead on large datasets.
- **Files**: `Workspace` holds `SqlFile`s (name + content + `connectionId`), persisted to `localStorage` via `src/lib/fileStorage.ts` (swap that module for a server store later). Results are session-only. `persist()` re-maps each file field by hand, so a new `SqlFile` field has to be added there too or it silently will not survive a reload.
- **Connection is per file**, not per app: `SqlFile.connectionId` decides which cluster a document's statements run against, so re-pointing one file leaves every other open file meaning what it meant. `Workspace.connectionId` and `.catalog` are getters over the active file. A stored `connectionId` the config no longer declares is healed back to the default on load (`#knownConnection`) — an id the config does not know can only 404 at the proxy — and `persist()` then writes the healed value back. `Workspace.catalogFor(id)` memoises one `CatalogCache` per connection for the session — browsing a Trino cluster is slow enough that throwing the tree away on a switch (which the old global connection did) is felt. Runs still build a fresh `Trino` client each time, since the client carries mutable session header state.
- **Result ↔ statement association**: results belong strictly to Monaco range anchors (`Result.anchorId`), not SQL strings. Multiple identical statements in a file remain completely independent. Erasing a statement collapses its anchor and drops its result: cutting a statement loses its result, and pasting it back — anywhere — starts from an empty strip. (Reclaiming a result by matching a pasted statement's text against the erased one was tried and removed; it was the one rule here that could guess wrong, since two identical statements could swap results.) Re-running replaces only that specific statement's result, and a result that is dropped (statement erased, re-run, evicted, file deleted) is stopped via `Result.discard()` rather than left polling. The anchor decorations are `NeverGrowsWhenTypingAtEdges`: on monaco's default stickiness an insert at either edge extends the decoration, so typing a new statement below a finished one grew that one's anchor across both and the new statement came up already showing its neighbour's result.
- **Statement toolbar** (`Editor.svelte`): the `▶ Run / ☰ Results / ✕ Cancel` strip above each statement is a monaco *content widget* over a view zone, built by the component itself — not a `CodeLensProvider`. Monaco puts two chained 250ms+ debounces in front of code lens provide and resolve with no public flush, so a running query's state reached the lens a third of a second late; owning the DOM makes a state change a `textContent` write. `syncToolbars()` reuses one strip per statement, re-anchors them on every edit (a content widget only refreshes its cached model position when laid out), and hands the buttons straight to the `onexecutesql` / `onshowresult` / `oncancelresult` props. Cancel (`Result.cancel()` → `DELETE /v1/query/{id}`) is reported back by Trino as a `USER_CANCELED` error, so failed and cancelled results share the `.status.failed` styling, with the Trino error name in the tooltip. A failed statement reads `Error` behind a warning triangle rather than offering rows it does not have, and `Details` is a plain `<a href>` to the `infoUri` Trino reports for the query — the proxy deliberately does not rewrite that one, so it points at the cluster's own UI. The icons are `@lucide/svelte` components `mount()`ed into that hand-built DOM, and the stylesheet has to give them `max-width: none`: a content widget with `allowEditorOverflow: false` is capped at the editor's content width, read once when the widget is added, which is 0 for the strips built before the editor's first layout — an ancestor `max-width: 0` that nowrap label text overflows harmlessly but that collapsed the icons, which is why a fresh strip used to read `Run` with nothing beside it.
- **Trino client** (`src/lib/trino/index.ts`): Async iterator over paginated Trino REST API responses. Manages Trino session headers (catalog, schema, prepared statements) across requests. One `Client` instance per query — not safe for concurrent use due to mutable header state.
- **Type conversion** (`src/lib/trino/table.ts`): Converts Trino `TypeSignature` → table `Field`/`DataType`. Handles nested rows, arrays, and binary (base64→Uint8Array).
- **Type *strings*** (`src/lib/trino/typeString.ts`): the other direction onto the same types, and deliberately separate from `table.ts`. `table.ts` walks a `TypeSignature`, the structure Trino attaches to query *results*; the catalog only ever reports a rendered string (`row("a" integer, "b" array(varchar))`), and recovering the structure by re-asking the engine would be a query per column. So this parses the string: `typeChildren` (a row's fields, a map's key/value; an array unwraps to its *element's* children so `array(row(...))` expands straight to the row's fields rather than through a level that says nothing), `typeCategory` (which icon), `abbreviateType` (`row(…)`). The shapes it handles were read off the engine, not assumed: named row fields are always quoted and `""` escapes a quote, anonymous ones are bare types (shown as `[1]`, `[2]`, which is how you subscript them), field names contain dots and spaces, and `timestamp(6) with time zone` puts words *after* the parameter list.
- **Table** (`src/lib/components/table/`): Virtual-scrolling table rendering only visible rows. Selection is a lightweight rect; `getData()` lazily extracts and converts cell values. Rows are 30px, the header is a 36px rail carrying the column name over its type — a column is routinely named wider than anything in it, and stacking buys those characters back without paying for them in table width. Body cells have horizontal hairlines only: the vertical rules made every cell a box, and column tracking is carried instead by the header separators, the row-number gutter, and right alignment plus tabular figures on numeric columns (every numeric Trino type maps to the `"integer"` DataType, so that is the test).
- **Split pane layout**: Three-pane UI (schema browser | document | inspector) using `SplitPane` component with draggable dividers. Each pane owns a 36px `.rail` at its top edge, which is what makes the three headers line up as one band across the window without any of them knowing about the others. The inspector is toggled by moving its split to `pos: "100%"` — SplitPane renders neither the second section nor the divider at that position, so "closed" is just a remembered position rather than a second layout.
- **Inspector** (`DataViewer.svelte`): reads whatever the table has selected, at full window height, as one *document per selected row* — field/value pairs with structs and arrays flattened to dotted paths, headed by the row number the table shows so a value traces back to its row. It is a pane of the window rather than a region of the results, which is what lets the whole selection be readable at once and would let it serve a document type other than a SQL file. `⌘I` toggles it, registered both as a monaco action and on `window` for the same reason `⌘P` is.
- **The three surfaces** each do one job, which is why there is no left-hand accordion any more. `SchemaBrowser.svelte` is the drawer: one full-height tree for the active document's connection. Its filter narrows *what is already loaded*; opening a branch is the only thing in it that reaches the cluster, and that takes a click. Nothing on the keystroke path may call `CatalogCache.load*`, or a cluster with slow connectors would crawl. A column expands too: its type string already describes the whole shape, so row fields hang under it as child nodes, recursively and without touching the cluster — opening one is a pure display change, and only the catalog/schema/table levels carry a `load`. Because a column's fields sit at no fixed depth, and because a Trino field can be named `weird name.with dot`, the old trick of reading a node's kind back out of its id by counting dots is gone: ids join their segments with a unit separator, and what each node *is* (its icon, and whether it fetches) is recorded in a `meta` map beside the tree, where it is built. Types carry an icon each — braces for row, brackets for array, hash, clock, binary — and an expandable type's own text is abbreviated to `row(…)`, since the full text of a nested row runs to hundreds of characters and would otherwise set the width of the whole pane; the untruncated name and type are on the row's `title`. `TreeView` is stateless — the set of open ids is the whole truth and is passed in, so the chevron cannot draw one thing while a click does another. The browser keeps that set per connection (ids collide across clusters). A filter does not decide what is open — you do: a branch is open because you had it open, plus the ancestors holding a match on screen, minus anything clicked shut while the filter is up (`filterOverride`). So filtering never reveals a subtree you had collapsed — it cannot paint three thousand rows you were not already looking at — and whatever you had expanded under a match stays exactly where it was. `DocumentHeader.svelte` sits above the editor carrying the document's name and its connection (`file │ connection`, a rule between them: the file is the noun, the connection is its address). `FileSwitcher.svelte` is the Cmd+P palette that replaced the drawer's file list; the chord is registered both as a monaco action (the editor holds focus and would swallow it) and on `window` (everywhere else, and to keep the browser's print dialog out of it).

### Server-side

- **Hooks** (`src/hooks.server.ts`): `sequence(LoggingHandler, SessionHandler, AuthnHandler)`. Session is an encrypted cookie (AES-GCM via Web Crypto) pointing to a server-side session store.
- **Auth**: Pluggable — `NoAuthn` (dev) or OIDC with PKCE, token refresh via priority queue.
- **Proxy** (`src/routes/api/trino/[id]/[...path]/+server.ts`): Forwards requests to configured Trino connections, rewrites `nextUri`/`partialCancelUri` in responses to route back through the proxy. Adds `X-Trino-User` and bearer token from session.
- **Config** (`src/lib/server/config.ts`): ArkType-validated config loaded from `TRINETTE_CONFIG` env var (JSON file path). Defines connections, session settings, and authn mode.

### Monaco language package

`packages/monaco-language-trino/` is a bun workspace package providing Trino SQL support: ANTLR-generated parser (SqlBase.g4), completion, semantic tokens, diagnostics, folding, and statement splitting. Imported as `monaco-language-trino`.

**The app consumes this package's TypeScript source, not a build.** Its `exports` point at `src/index.ts`, the workspace makes `node_modules/monaco-language-trino` a symlink to `packages/`, and `optimizeDeps.exclude` in `vite.config.ts` keeps vite from pre-bundling it. So an edit under `packages/` is live immediately — no `build:lib`, no `bun install`, no clearing `node_modules/.vite`. Each of those was previously a way for the running app to silently keep executing stale code, which is easy to miss because the app fails by rendering nothing rather than erroring. `bun run check` now type-checks the package source along with the app, so drift shows up there too.

`build:lib` still exists for publishing the package standalone, but nothing in this repo consumes `dist/`. `build:grammar` regenerates the parser and then runs `fix:generated`, which restores the type-only `ParseTreeListener` import that the app's `verbatimModuleSyntax` requires and antlr-ng does not emit.

## Key conventions

- **Svelte 5 runes** throughout: `$state`, `$state.raw`, `$derived`, `$derived.by`, `$effect`, `$bindable`. No stores.
- **Snippets** for component composition (table cell renderers, split pane slots).
- Large/frequently-updated data (`Query.data`, `Query.columns`, `Query.stats`) must use `$state.raw()`, not `$state()`, to avoid proxy overhead.
- **The design system lives in `src/style.css`** and is deliberately small: two text sizes (`--text` 13/20, `--text-sm` 11/16), four heights (`--h-rail` 36, `--h-row` 30, `--h-tree` 26, `--h-ctl` 24), three radii (`--r-panel` 8, `--r` 6, `--r-kbd` 4), one icon size (14px, 12px for chevrons), and one accent with four jobs — selection, focus, the running statement, links. Spacing is used literally on a 6/8/12/16 scale rather than tokenised. Surfaces are a monotonic ramp `--s0`..`--s3` plus `--line`/`--line-strong`, and text is `--fg`/`--fg-2`/`--fg-3`; the ramp means the same thing in both themes, which the old `--bg-1`/`--bg-2` and `--border`/`--border-dark` pairs did not — each swapped which one was stronger when the theme flipped. `data-theme` on `<html>` picks the palette. A handful of global primitives (`.rail`, `.chip`, `.meta`, `.ell`, `.mono`, `kbd`) are shared rather than re-declared per component.
- Formatting: 2-space indent, double quotes, no trailing commas, 100-char line width (Prettier with Svelte plugin).


# MCP

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
