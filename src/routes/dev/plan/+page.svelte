<script lang="ts">
  /**
   * A bench for the plan graph while there is no `Explain` action to reach
   * it through: the docs example, laid out the way the results pane and the
   * inspector will show it. Not linked from anywhere.
   */
  import { Workflow } from "@lucide/svelte";
  import { page } from "$app/state";
  import FragmentGraph from "$lib/components/plan/FragmentGraph.svelte";
  import { EXAMPLE_PLAN } from "$lib/plan/example";
  import { fragmentsOf } from "$lib/plan/fragments";
  import type { PlanNode } from "$lib/plan/types";
  import { theme } from "$lib/theme.svelte";

  // `?node=4` opens with that operator picked, and `?theme=dark` with that
  // palette — so a screenshot can show a state a headless browser cannot
  // click its way into.
  const initialNode = page.url.searchParams.get("node");
  const initialTheme = page.url.searchParams.get("theme");
  if (initialTheme === "light" || initialTheme === "dark") theme.pick(initialTheme);

  let picked: { node: PlanNode; fragmentId: string } | null = $state(
    (() => {
      if (!initialNode) return null;
      for (const fragment of fragmentsOf(EXAMPLE_PLAN))
        for (const { node } of fragment.rows)
          if (node.id === initialNode) return { node, fragmentId: fragment.id };
      return null;
    })()
  );

  let entries = $derived.by(() => {
    if (!picked) return [];
    const { node } = picked;
    const rows: { group: string; key: string; value: string }[] = [];
    rows.push({ group: "node", key: "name", value: node.name });
    rows.push({ group: "node", key: "id", value: node.id });
    rows.push({ group: "node", key: "fragment", value: picked.fragmentId });
    for (const [key, value] of Object.entries(node.descriptor))
      rows.push({ group: "descriptor", key, value });
    for (const { symbol, type } of node.outputs)
      rows.push({ group: "outputs", key: symbol, value: type });
    node.details.forEach((detail, i) =>
      rows.push({ group: "details", key: String(i), value: detail })
    );
    for (const [key, value] of Object.entries(node.estimates[0] ?? {}))
      rows.push({ group: "estimates", key, value: String(value) });
    return rows;
  });

  let fragmentCount = Object.keys(EXAMPLE_PLAN).length;

  $effect(() => theme.watch());
  $effect(() => {
    document.documentElement.dataset.theme = theme.resolved;
  });
</script>

<div class="bench">
  <div class="results">
    <div class="rail">
      <Workflow size={14} />
      <span>Plan</span>
      <span class="sep">&middot;</span>
      <span class="soft">{fragmentCount} fragments</span>
      <span class="fill"></span>
      <span class="meta mono">EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON)</span>
    </div>
    <div class="graph">
      <FragmentGraph
        plan={EXAMPLE_PLAN}
        selected={picked?.node.id}
        onselect={(node, fragmentId) => (picked = { node, fragmentId })}
      />
    </div>
  </div>

  <div class="inspector">
    <div class="rail">
      <span class="ell title">
        {#if picked}{picked.node.name} &middot; node {picked.node.id}{:else}Inspector{/if}
      </span>
    </div>
    <div class="stack">
      {#if !picked}
        <p class="empty">Click an operator in the plan to inspect it.</p>
      {/if}
      {#each entries as entry, i (entry.group + entry.key)}
        {#if i === 0 || entries[i - 1].group !== entry.group}
          <div class="group">{entry.group}</div>
        {/if}
        <div class="field">
          <span class="key ell" title={entry.key}>{entry.key}</span>
          <span class="value mono" class:null={entry.value === "NaN"}>{entry.value}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .bench {
    display: flex;
    height: 100vh;
  }

  .results {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .results .rail :global(svg) {
    color: var(--fg-3);
  }

  .sep,
  .soft {
    color: var(--fg-3);
  }

  .fill {
    flex: 1;
  }

  .graph {
    flex: 1;
    min-height: 0;
  }

  .inspector {
    width: 320px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--line-strong);
    background: var(--s1);
  }

  .title {
    flex: 1;
  }

  .stack {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .empty {
    padding: 16px 12px;
    color: var(--fg-3);
  }

  .group {
    height: var(--h-ctl);
    line-height: var(--h-ctl);
    padding: 0 12px;
    background: var(--s2);
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    color: var(--fg-2);
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .field {
    display: grid;
    grid-template-columns: 40% 1fr;
    gap: 8px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--line);
  }

  .key {
    color: var(--fg-2);
  }

  .value {
    word-break: break-all;
  }

  .null {
    color: var(--fg-3);
    font-style: italic;
  }
</style>
