<script lang="ts">
  import Application from "$lib/components/Application.svelte";
  import { Workspace } from "$lib/State.svelte";
  import { page } from "$app/state";

  const defaultConnectionId = page.data.connections?.[0]?.id ?? "";
  let workspace = $state(new Workspace(defaultConnectionId));
</script>

<Application bind:workspace />
