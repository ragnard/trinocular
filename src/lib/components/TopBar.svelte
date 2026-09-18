<script lang="ts">
  import Account from "./Account.svelte";
  import logo from "$lib/assets/logo.svg";
  import { BUILD, describeBuild } from "$lib/build";
  import type { Branding } from "$lib/server/config";

  interface Props {
    branding: Branding;
    userId?: string;
    /** Absent when there is no provider to sign out of (`authn: none`). */
    logoutPath?: string;
  }

  let { branding, userId, logoutPath }: Props = $props();
</script>

<header class="rail topbar">
  <span class="wordmark" title={describeBuild(BUILD)}>
    <img class="logo" src={logo} alt="" />
    {branding.name}
  </span>
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
  /* A rail on the page's own surface, set off by a rule twice a hairline:
     a shadow and then a fade were tried and both read as one more hairline.
     Grid rather than flex so the message centres on the window, not between
     its neighbours. */
  .topbar {
    display: grid;
    grid-template-columns: minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr);
    padding-right: 6px;
    background: var(--s0);
    border-bottom-width: 2px;
  }

  .wordmark {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--fg);
    user-select: none;
  }

  .logo {
    width: 20px;
    height: 20px;
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
