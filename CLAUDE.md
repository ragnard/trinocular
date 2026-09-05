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
- **Files**: `Workspace` holds `SqlFile`s (name + content), persisted to `localStorage` via `src/lib/fileStorage.ts` (swap that module for a server store later). Results are session-only.
- **Result ↔ statement association**: results belong strictly to Monaco range anchors (`Result.anchorId`), not SQL strings. Multiple identical statements in a file remain completely independent. Erasing a statement detaches its result (invisible, zeroed anchor); cutting and pasting the statement back allows the unanchored result to be claimed 1:1 by exact text match at the new position. Re-running replaces only that specific statement's result. The `☰ Results` code lens points the results pane at a statement's result; while the query runs a `✕ Cancel` lens sits beside it (`Result.cancel()` → `DELETE /v1/query/{id}`, which Trino reports back to the polling loop as a `USER_CANCELED` error). Monaco gives lenses no per-lens class, so the failed lens is coloured through the `$(error)` codicon in its title (`a:has(.codicon-error)` in `Editor.svelte`).
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
