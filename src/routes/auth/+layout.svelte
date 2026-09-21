<script lang="ts">
  /**
   * The three pages a signed-out or refused user can see — login, error,
   * forbidden — are one centred card each, and until this layout each carried
   * its own copy of the card's stylesheet. The rules are global under `.auth`
   * because the pages own the markup and this owns how it is drawn.
   */
  let { children } = $props();
</script>

<div class="auth">
  {@render children()}
</div>

<style>
  .auth {
    max-width: 400px;
    margin: 120px auto;
    padding: 32px;
    text-align: center;
  }

  /* Body size, weight for the heading: the system has two text sizes and
     this is not a third. */
  .auth :global(h1) {
    font-size: var(--text);
    line-height: var(--leading);
    font-weight: 600;
    margin-bottom: 8px;
  }

  .auth :global(p) {
    color: var(--fg-2);
    margin-bottom: 16px;
  }

  .auth :global(code) {
    font-family: var(--font-mono);
    user-select: all;
  }

  /* The login form: fields stacked and left-aligned under the centred
     heading, the button back on the page's centre line. */
  .auth :global(form) {
    display: grid;
    gap: 12px;
    text-align: left;
  }

  .auth :global(label) {
    display: grid;
    gap: 4px;
    color: var(--fg-2);
  }

  .auth :global(.textbox) {
    width: 100%;
    color: var(--fg);
  }

  .auth :global(form p) {
    margin: 0;
  }

  .auth :global(.button) {
    display: inline-block;
    justify-self: center;
    margin-top: 16px;
    padding: 8px 24px;
    border: none;
    border-radius: var(--r);
    background: var(--accent);
    color: #fff;
    font: inherit;
    text-decoration: none;
    cursor: pointer;
  }

  .auth :global(.button:hover) {
    opacity: 0.9;
  }
</style>
