<script lang="ts">
  import { page } from "$app/state";

  const { requestId } = page.data;
</script>

<div class="container">
  <h1>Authentication failed</h1>
  <p>Something went wrong during sign-in. Please try again.</p>
  {#if requestId}
    <p class="request-id">Request ID: <code>{requestId}</code></p>
  {/if}
  <a href="/auth/login" class="button">Try again</a>
</div>

<style>
  .container {
    max-width: 400px;
    margin: 120px auto;
    padding: 32px;
    text-align: center;
    font-family: var(--font, sans-serif);
    color: var(--text-0);
  }

  h1 {
    font-size: 1.4em;
    margin-bottom: 8px;
  }

  p {
    color: var(--text-1);
    margin-bottom: 16px;
  }

  .request-id {
    font-size: var(--font-sm);
    color: var(--text-2);
  }

  .request-id code {
    font-family: var(--font-mono, monospace);
    user-select: all;
  }

  .button {
    display: inline-block;
    margin-top: 16px;
    padding: 8px 24px;
    background: var(--accent);
    color: #fff;
    border-radius: 4px;
    text-decoration: none;
    font-size: 0.9em;
  }

  .button:hover {
    opacity: 0.9;
  }
</style>
