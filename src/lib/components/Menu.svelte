<script lang="ts">
  import type { Query, Workspace } from "$lib/State.svelte";

  interface Props {
    workspace: Workspace;
  }

  let { workspace }: Props = $props();

  const setLatestQuery = (q: Query) => {
    console.log('whepp');
    workspace.setLatestQuery(q);
  }

</script>

<section>
  <h1>Queries</h1>

  {#each workspace.queries as query (query.id)}
    <div>
      <a onclick={(_ev) => setLatestQuery(query)}>{query.id} {query.queryState}</a>
    </div>
  {/each}
</section>

<style>
</style>
