<script lang="ts" module>
  import type { DataType as DT, Struct as S, List as L } from "./table/Table.svelte";

  function isStructM(dt: DT): dt is S {
    return typeof dt === "object" && !Array.isArray(dt) && "fields" in dt;
  }

  function isListM(dt: DT): dt is L {
    return Array.isArray(dt);
  }

  export function formatPreview(val: any, dt: DT): string {
    if (val === null || val === undefined) return "null";
    if (isStructM(dt) && Array.isArray(val)) {
      const parts = dt.fields.map((f, i) => {
        const v = val[i];
        if (v === null || v === undefined) return `${f.name}: null`;
        if (isStructM(f.dataType) || isListM(f.dataType)) return `${f.name}: {...}`;
        return `${f.name}: ${v}`;
      });
      return `{${parts.join(", ")}}`;
    }
    if (isListM(dt) && Array.isArray(val)) {
      if (val.length === 0) return "[]";
      return `[${val.length} items]`;
    }
    return String(val);
  }
</script>

<script lang="ts">
  import type { DataType, Struct, List } from "./table/Table.svelte";
  import ValueNode from "./ValueNode.svelte";

  interface Props {
    value: any;
    dataType: DataType;
    label?: string;
    depth?: number;
  }

  let { value, dataType, label, depth = 0 }: Props = $props();

  let expanded = $state(false);

  function isStruct(dt: DataType): dt is Struct {
    return typeof dt === "object" && !Array.isArray(dt) && "fields" in dt;
  }

  function isList(dt: DataType): dt is List {
    return Array.isArray(dt);
  }

  function formatPrimitive(val: any): string {
    if (val === null || val === undefined) return "null";
    return String(val);
  }
</script>

{#if value === null || value === undefined}
  <div class="node" style:padding-left="{depth * 16}px">
    {#if label}<span class="label">{label}</span>{/if}
    <span class="null">null</span>
  </div>
{:else if isStruct(dataType)}
  <div class="node" style:padding-left="{depth * 16}px">
    <button class="toggle" onclick={() => expanded = !expanded}>
      {expanded ? "\u25BE" : "\u25B8"}
    </button>
    {#if label}<span class="label">{label}</span>{/if}
    {#if !expanded}
      <span class="preview">{formatPreview(value, dataType)}</span>
    {/if}
  </div>
  {#if expanded}
    {#each dataType.fields as field, i}
      <ValueNode
        value={Array.isArray(value) ? value[i] : value}
        dataType={field.dataType}
        label={field.name}
        depth={depth + 1}
      />
    {/each}
  {/if}
{:else if isList(dataType)}
  <div class="node" style:padding-left="{depth * 16}px">
    <button class="toggle" onclick={() => expanded = !expanded}>
      {expanded ? "\u25BE" : "\u25B8"}
    </button>
    {#if label}<span class="label">{label}</span>{/if}
    {#if !expanded}
      <span class="preview">{formatPreview(value, dataType)}</span>
    {/if}
  </div>
  {#if expanded && Array.isArray(value)}
    {#each value as element}
      <ValueNode
        value={element}
        dataType={dataType[0]}
        depth={depth + 1}
      />
    {/each}
  {/if}
{:else}
  <div class="node" style:padding-left="{depth * 16}px">
    {#if label}<span class="label">{label}</span>{/if}
    <span class="value">{formatPrimitive(value)}</span>
  </div>
{/if}

<style>
  .node {
    display: flex;
    align-items: baseline;
    gap: 0.35em;
    padding: 1px 0;
    min-height: 1.5em;
    line-height: 1.5;
  }

  .toggle {
    all: unset;
    cursor: pointer;
    width: 1em;
    text-align: center;
    flex-shrink: 0;
    color: var(--text-2);
    font-size: 0.85em;
  }

  .toggle:hover {
    color: var(--accent);
  }

  .label {
    color: var(--text-2);
    flex-shrink: 0;
  }

  .label::after {
    content: ":";
  }

  .value {
    word-break: break-all;
  }

  .null {
    color: var(--text-2);
    font-style: italic;
  }

  .preview {
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
