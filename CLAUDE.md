# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Trinette?

A web-based SQL query IDE for the Trino distributed query engine. Users write SQL in a Monaco editor, execute queries against Trino clusters via a server-side proxy, and browse results in a virtualized table with a detail inspector.

## Commands

```bash
bun install              # Install dependencies (uses bun workspaces)
bun run dev              # Dev server on port 5173
bun run build            # Production build (SvelteKit node adapter)
bun run check            # Type-check with svelte-check
bun run preview          # Preview production build
```

No test framework is configured.

## Architecture

### Client-side data flow

```
Monaco Editor → handleExecuteSql() → Trino client (fetch) → server proxy → Trino cluster
                                          ↓
                              Query (State.svelte.ts)
                              accumulates chunks into $state.raw fields
                                          ↓
                              Query.svelte → Table.svelte (virtual scroll)
                                                ↓ (Selection: rect + lazy getData)
                                          DataViewer.svelte (debounced)
```

- **State management**: Svelte 5 runes on class instances (`Workspace`, `Query` in `src/lib/State.svelte.ts`). `Query` fields use `$state.raw()` to avoid deep proxy overhead on large datasets.
- **Trino client** (`src/lib/trino/index.ts`): Async iterator over paginated Trino REST API responses. Manages Trino session headers (catalog, schema, prepared statements) across requests. One `Client` instance per query — not safe for concurrent use due to mutable header state.
- **Type conversion** (`src/lib/trino/table.ts`): Converts Trino `TypeSignature` → table `Field`/`DataType`. Handles nested rows, arrays, and binary (base64→Uint8Array).
- **Table** (`src/lib/components/table/`): Virtual-scrolling table rendering only visible rows. Selection is a lightweight rect; `getData()` lazily extracts and converts cell values.
- **Split pane layout**: Three-pane UI (menu | editor+results | data viewer) using `SplitPane` component with draggable dividers.

### Server-side

- **Hooks** (`src/hooks.server.ts`): `sequence(LoggingHandler, SessionHandler, AuthnHandler)`. Session is an encrypted cookie (AES-GCM via Web Crypto) pointing to a server-side session store.
- **Auth**: Pluggable — `NoAuthn` (dev) or OIDC with PKCE, token refresh via priority queue.
- **Proxy** (`src/routes/api/trino/[id]/[...path]/+server.ts`): Forwards requests to configured Trino connections, rewrites `nextUri`/`partialCancelUri` in responses to route back through the proxy. Adds `X-Trino-User` and bearer token from session.
- **Config** (`src/lib/server/config.ts`): ArkType-validated config loaded from `TRINETTE_CONFIG` env var (JSON file path). Defines connections, session settings, and authn mode.

### Monaco language package

`packages/monaco-language-trino/` is a workspace package providing Trino SQL support: ANTLR-generated parser (SqlBase.g4), completion, semantic tokens, diagnostics, folding, and statement splitting. Imported as `monaco-language-trino`.

## Key conventions

- **Svelte 5 runes** throughout: `$state`, `$state.raw`, `$derived`, `$derived.by`, `$effect`, `$bindable`. No stores.
- **Snippets** for component composition (table cell renderers, split pane slots).
- Large/frequently-updated data (`Query.data`, `Query.columns`, `Query.stats`) must use `$state.raw()`, not `$state()`, to avoid proxy overhead.
- CSS theming via custom properties (`--bg-0`, `--text-0`, `--accent`, etc.) toggled by `data-theme` attribute on `<html>`.
- Formatting: 2-space indent, double quotes, no trailing commas, 100-char line width (Prettier with Svelte plugin).

## References

- Svelte/SvelteKit LLM docs: https://svelte.dev/llms.txt — consult when up-to-date Svelte or SvelteKit information is needed.
