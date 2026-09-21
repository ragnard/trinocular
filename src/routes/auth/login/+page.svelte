<script lang="ts">
  import { page } from "$app/state";

  let { form } = $props();

  // Carried through the form rather than read off the action's URL, so the
  // page a signed-out user was sent from is where a successful login lands.
  const returnTo = $derived(page.url.searchParams.get("returnTo") ?? "/");
</script>

<h1>{page.data.branding.name}</h1>
<p>Sign in to continue.</p>

<form method="POST">
  <input type="hidden" name="returnTo" value={returnTo} />
  <label>
    Username
    <input
      class="textbox"
      type="text"
      name="username"
      autocomplete="username"
      autocapitalize="none"
      spellcheck="false"
      required
      value={form?.username ?? ""}
      aria-invalid={form?.failed ? "true" : undefined}
    />
  </label>
  <label>
    Password
    <input
      class="textbox"
      type="password"
      name="password"
      autocomplete="current-password"
      required
      aria-invalid={form?.failed ? "true" : undefined}
    />
  </label>
  <!-- One message for a wrong name and a wrong password: which it was is
       exactly what a guesser is trying to find out. -->
  {#if form?.throttled}
    <p class="warn small">Too many attempts. Wait a moment and try again.</p>
  {:else if form?.failed}
    <p class="warn small">Wrong username or password.</p>
  {/if}
  <button class="button" type="submit">Sign in</button>
</form>
