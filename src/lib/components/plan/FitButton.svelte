<script lang="ts">
  // A component rather than a snippet in the graph because `useSvelteFlow`
  // reads context, which only works while a component is being set up.
  import { useSvelteFlow } from "@xyflow/svelte";
  import { Maximize } from "@lucide/svelte";

  const { fitView } = useSvelteFlow();
</script>

<button
  class="chip square"
  title="Fit the plan to the pane"
  onclick={() => fitView({ padding: 0.1 })}
>
  <Maximize size={14} />
</button>

<style>
  .chip {
    background: var(--s1);
    border: 1px solid var(--line-strong);
  }
</style>
