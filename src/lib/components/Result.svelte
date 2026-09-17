<script lang="ts">
  import { MAX_HOLD_MS, type Result as ResultModel } from "$lib/State.svelte";
  import { formatCount } from "$lib/format";
  import { Table, fieldFromTypeSignature, convertValue } from "./table";
  import type { Schema, Selection, ValueConverter } from "./table/types";
  import type { Columns } from "$lib/trino";
  import { abbreviateType, typeCategory } from "$lib/trino/typeString";
  import { Download, ListEnd, TriangleAlert } from "@lucide/svelte";
  import QueryProgress from "./QueryProgress.svelte";
  import TypeIcon from "./TypeIcon.svelte";
  import Dropdown from "./Dropdown.svelte";
  import { EXPORT_FORMATS, clipboardText, downloadText, type ExportFormat } from "$lib/export";

  interface Props {
    result: ResultModel | null;
    selection?: Selection | null;
    /** Rows the next run shows before pausing to ask, while `limitRows` is on. */
    rowLimit?: number;
    limitRows?: boolean;
  }

  let {
    result,
    selection = $bindable(null),
    rowLimit = $bindable(1000),
    limitRows = $bindable(true)
  }: Props = $props();

  function setLimit(input: HTMLInputElement) {
    const n = Math.floor(Number(input.value));
    if (Number.isFinite(n) && n >= 1) rowLimit = n;
    input.value = String(rowLimit);
  }

  const toSchema = (columns?: Columns): Schema | undefined =>
    columns && {
      fields: columns.map((col) => fieldFromTypeSignature(col.typeSignature, col.name, col.type))
    };

  let schema = $derived(toSchema(result?.columns));
  let hasRows = $derived((result?.data?.length ?? 0) > 0);

  const valueConverter: ValueConverter = (value, field) => convertValue(value, field.dataType);

  /**
   * Columns are enough to save: a result with no rows still has a header worth
   * writing, and one that failed has neither. Saving mid-run writes the rows
   * that have arrived, which is the number the rail is showing.
   */
  let canSave = $derived(!!schema && !result?.error);

  function save(format: ExportFormat) {
    if (!schema) return;
    // The query id, so a saved file still says which run it came from.
    const name = `${result?.queryId ?? "query"}.${format.extension}`;
    downloadText(name, format.mimeType, format.serialize(schema.fields, result?.data ?? []));
  }
</script>

<div class="result">
  <!-- The results pane had no header at all, so the editor and the table just
       butt together. This is the shoulder that split was missing. -->
  <div class="rail">
    {#if result}
      <span class="dot" class:failed={!!result.error} class:running={result.running}></span>
      <span>{result.rowCount ?? 0} rows</span>
      <span class="sep">&middot;</span>
      <span class="soft">{result.elapsedTimeSeconds} s</span>
    {:else}
      <span class="soft">No result</span>
    {/if}
    <span class="fill"></span>
    <!-- What the *next* run does; a run already made carries its own cap. -->
    <div class="limit">
      <button
        class="chip"
        aria-pressed={limitRows}
        title={limitRows
          ? `New runs pause after ${formatCount(rowLimit)} rows and ask before fetching more`
          : "New runs fetch every row"}
        onclick={() => (limitRows = !limitRows)}
      >
        <ListEnd size={14} />
        {limitRows ? "Limit" : "No limit"}
      </button>
      {#if limitRows}
        <input
          type="number"
          min="1"
          step="1"
          value={rowLimit}
          aria-label="Rows to show before pausing"
          onchange={(e) => setLimit(e.currentTarget)}
          onkeydown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      {/if}
    </div>
    <Dropdown icon={Download} label="Save" title="Save these results to a file" disabled={!canSave}>
      {#snippet menu()}
        {#each EXPORT_FORMATS as format (format.id)}
          <button onclick={() => save(format)}>
            {format.label}
            <span class="ext meta">.{format.extension}</span>
          </button>
        {/each}
      {/snippet}
    </Dropdown>
  </div>

  {#if !result}
    <div class="message">Run a statement to see results here</div>
  {:else if result.error}
    <div class="message failed">
      <TriangleAlert size={20} />
      <p>{result.error.message}</p>
      <p class="meta">{result.error.errorName} &middot; {result.error.errorCode}</p>
    </div>
  {:else if !hasRows && result.running}
    <!-- No rows to look at yet, so the pane is free to show what the cluster is
         actually doing. Once rows arrive the table takes over and progress
         carries on in the strip above it. -->
    <QueryProgress {result} />
  {:else if schema}
    {#if result.held}
      <!-- In place of the progress strip: nothing is polled while held, so
           the stats it would draw from stop moving. -->
      <div class="notice">
        <span class="text">
          Showing the first {formatCount(result.rowCount)} rows. More are available; the query is paused
          on the cluster.
        </span>
        <button class="chip" onclick={() => result.fetchMore()}>
          Fetch {formatCount(result.step)} more
        </button>
        <button class="chip" onclick={() => result.fetchAll()}>Fetch all</button>
        <button class="chip" onclick={() => result.stop()}>Stop</button>
      </div>
    {:else if result.stopped}
      <div class="notice">
        <span class="text">
          Showing the first {formatCount(result.rowCount)} rows.
          {#if result.stopped === "expired"}
            The query was stopped after being paused for {MAX_HOLD_MS / 60_000} minutes; run it again
            to fetch more.
          {:else}
            The query was stopped; run it again to fetch more.
          {/if}
        </span>
      </div>
    {:else if result.running}
      <QueryProgress {result} compact />
    {/if}
    <Table {schema} rows={result.data} {valueConverter} {clipboardText} bind:selection>
      {#snippet header(field)}
        <!-- One line: the type is an icon beside the name rather than a second
             row of text under it. Spelled out, a type is mostly noise a column
             at a time — you read it once and then it is in the way of the
             name — while the icon is the same vocabulary the schema browser
             already taught, and it costs the width of one glyph. The name
             leads and the icon is pushed to the far edge, so the icons line up
             down the right of the header whatever the names do and read as a
             column of their own. The wording is on hover: the icon carries the
             type (abbreviated to `row`, since a nested row's full text runs to
             hundreds of characters), the name carries the name, untruncated. -->
        <div class="col" class:num={field.dataType === "integer"}>
          <span class="ell name" title={field.name}>{field.name}</span>
          <span class="kind" title={abbreviateType(field.dataTypeName)}>
            <TypeIcon category={typeCategory(field.dataTypeName)} />
          </span>
        </div>
      {/snippet}
      {#snippet empty()}
        <!-- A running query with no rows is handled above by the progress
             panel, so reaching the table's empty state means the query
             settled without producing any. -->
        <div class="message">No data</div>
      {/snippet}
    </Table>
  {:else}
    <!-- Not running and no schema: the statement settled without columns. -->
    <div class="message">No data</div>
  {/if}
</div>

<style>
  .result {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--s0);
  }

  .fill {
    flex: 1;
  }

  .sep {
    color: var(--fg-3);
  }

  .soft {
    color: var(--fg-2);
  }

  /* Three states, one shape: idle, running, failed. */
  .dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--ok);
  }

  .dot.running {
    background: var(--accent);
  }

  .dot.failed {
    background: var(--error);
  }

  .message {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    color: var(--fg-3);
    text-align: center;
  }

  .message.failed {
    color: var(--error);
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    min-height: var(--h-rail);
    padding: 6px 12px;
    background: var(--s1);
    border-bottom: 1px solid var(--line);
    color: var(--fg-2);
  }

  .notice .text {
    flex: 1;
    min-width: 0;
  }

  .notice .chip {
    flex: none;
  }

  .message p {
    max-width: 46em;
  }

  .limit {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .limit input {
    width: 10ch;
    height: var(--h-ctl);
    padding: 0 6px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r);
    background: var(--s0);
    color: inherit;
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .limit input:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  /* The extension is the answer to "what will the file be called", so it sits
     against the right edge rather than trailing the name. */
  .ext {
    margin-left: auto;
  }

  .col {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-width: 0;
  }

  /* Numeric columns are right-aligned in the body, so their name goes with
     them — up against the icon rather than across the gap from it. The icon
     itself does not move: it is the right edge either way, which is what lets
     the icons read as a column of their own. */
  .col.num {
    justify-content: flex-end;
  }

  .col .kind {
    display: flex;
    flex: none;
    color: var(--fg-3);
  }

  .col .name {
    color: var(--fg);
  }
</style>
