<script lang="ts">
  import Application from "$lib/components/Application.svelte";
  import { Workspace } from "$lib/State.svelte";

  let workspace = $state(new Workspace());

</script>

<Application bind:workspace />
