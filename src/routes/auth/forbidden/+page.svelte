<script lang="ts">
  let { data } = $props();
</script>

<div class="container">
  <h1>Not authorized</h1>
  <p>
    {#if data.userId}
      <code>{data.userId}</code> is signed in, but does not have access to Trinette.
    {:else}
      This account does not have access to Trinette.
    {/if}
  </p>
  <p class="hint">Ask an administrator to grant your account the required role.</p>
  {#if data.logoutPath}
    <form method="POST" action={data.logoutPath}>
      <button class="button" type="submit">Sign out</button>
    </form>
  {/if}
</div>

<style>
  .container {
    max-width: 400px;
    margin: 120px auto;
    padding: 32px;
    text-align: center;
    font-family: var(--font, sans-serif);
    color: var(--fg);
  }

  h1 {
    font-size: 1.4em;
    margin-bottom: 8px;
  }

  p {
    color: var(--fg-2);
    margin-bottom: 16px;
  }

  p code {
    font-family: var(--font-mono, monospace);
    user-select: all;
  }

  .hint {
    font-size: var(--text-sm);
    color: var(--fg-3);
  }

  .button {
    display: inline-block;
    margin-top: 16px;
    padding: 8px 24px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 4px;
    text-decoration: none;
    font-size: 0.9em;
    cursor: pointer;
  }

  .button:hover {
    opacity: 0.9;
  }
</style>
