<script lang="ts">
  import Application from "$lib/components/Application.svelte";
  import { Workspace } from "$lib/State.svelte";
  import { page } from "$app/state";

  const workspace = new Workspace(page.data.connections);
</script>

<Application {workspace} />
