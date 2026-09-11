<script lang="ts">
  // The wordmark stands where the logo will go.
  import Account from "./Account.svelte";
  import type { Branding } from "$lib/server/config";

  interface Props {
    branding: Branding;
    userId?: string;
    /** Absent when there is no provider to sign out of (`authn: none`). */
    logoutPath?: string;
  }

  let { branding, userId, logoutPath }: Props = $props();
</script>

<header class="topbar">
  <span class="wordmark">{branding.name}</span>
  <!-- The operator's HTML, from the config file. The CSP keeps a script in
       it from running; nothing else about it is checked. -->
  <div class="message ell">
    {#if branding.message}{@html branding.message}{/if}
  </div>
  <div class="account">
    <Account {userId} {logoutPath} />
  </div>
</header>

<style>
  .topbar {
    display: grid;
    grid-template-columns: minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr);
    align-items: center;
    gap: 8px;
    flex: none;
    height: var(--h-rail);
    padding: 0 6px 0 12px;
    background: var(--s0);
    border-bottom: 2px solid var(--line-strong);
  }

  .wordmark {
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--fg);
    user-select: none;
  }

  .message {
    text-align: center;
    color: var(--fg-2);
  }

  .message :global(a) {
    color: var(--accent);
  }

  .account {
    justify-self: end;
  }
</style>
