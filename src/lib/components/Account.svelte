<script lang="ts">
  /**
   * Who is signed in, what the app is drawn in, and the way out — one chip at
   * the right end of the top bar.
   *
   * The theme goes inside the menu rather than beside the label because it is
   * chosen about as often as a file is deleted, and a permanent control for
   * it costs the same width whether or not anyone ever wants it.
   *
   * Signing out has nowhere else to be. Until this, the only `Sign out` in the
   * app was on `/auth/forbidden`, which meant everyone allowed in was stuck.
   */
  import { Monitor, Moon, Sun, UserRound } from "@lucide/svelte";
  import Dropdown from "./Dropdown.svelte";
  import { theme, type ThemeChoice } from "$lib/theme.svelte";

  interface Props {
    userId?: string;
    /** Absent when there is no provider to sign out of (`authn: none`). */
    logoutPath?: string;
  }

  let { userId, logoutPath }: Props = $props();

  /**
   * The chip wears the part of an id that tells one person from another — the
   * domain says the same thing for everyone on a deployment; the whole of it
   * is on hover and at the head of the menu.
   */
  let short = $derived(userId ? userId.split("@")[0] : "Not signed in");

  const choices: { id: ThemeChoice; label: string; icon: typeof Monitor }[] = [
    { id: "system", label: "System", icon: Monitor },
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon }
  ];
</script>

<Dropdown icon={UserRound} label={short} title={userId ?? "Not signed in"}>
  {#snippet menu()}
    {#if userId}
      <p class="who meta ell">{userId}</p>
      <div class="separator"></div>
    {/if}

    {#each choices as choice (choice.id)}
      {@const Icon = choice.icon}
      <button class:selected={choice.id === theme.choice} onclick={() => theme.pick(choice.id)}>
        <Icon size={14} />
        {choice.label}
      </button>
    {/each}

    {#if logoutPath}
      <div class="separator"></div>
      <!-- A POST, like the forbidden page's: signing out revokes the refresh
           token and destroys the session before handing the user to the
           provider, none of which belongs behind a link a browser may
           prefetch. `Menu` closes on the click, on the way down, which leaves
           the submit itself alone. -->
      <form method="POST" action={logoutPath}>
        <button type="submit">Sign out</button>
      </form>
    {/if}
  {/snippet}
</Dropdown>

<style>
  .who {
    max-width: 22em;
    margin: 0;
    padding: 2px 12px 6px;
  }

  button.selected {
    color: var(--accent);
  }
</style>
