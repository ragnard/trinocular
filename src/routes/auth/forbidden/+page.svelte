<script lang="ts">
  import { page } from "$app/state";
</script>

<h1>Not authorized</h1>
<p>
  {#if page.data.userId}
    <code>{page.data.userId}</code> is signed in, but does not have access to Trinette.
  {:else}
    This account does not have access to Trinette.
  {/if}
</p>
<p class="meta">Ask an administrator to grant your account the required role.</p>
{#if page.data.logoutPath}
  <!-- Signing out is the only move a refused user has: the account is wrong,
       not the request. With no provider there is nothing to sign out of. -->
  <form method="POST" action={page.data.logoutPath}>
    <button class="button" type="submit">Sign out</button>
  </form>
{/if}
