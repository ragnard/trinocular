<script lang="ts">
  import { page } from "$app/state";
</script>

<h1>Authentication failed</h1>
<p>Something went wrong during sign-in. Please try again.</p>
{#if page.data.requestId}
  <p class="meta">Request ID: <code>{page.data.requestId}</code></p>
{/if}
<a href="/auth/login" class="button">Try again</a>
