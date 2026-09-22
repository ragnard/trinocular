<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** Fired however the dialog closed: Escape, the backdrop, or `close()`. */
    onclose: () => void;
    /** Sized to its content and centred, rather than the window less a margin. */
    fit?: boolean;
    children: Snippet;
  }

  let { onclose, fit = false, children }: Props = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    dialog.showModal();
  });

  /** Through the element's own close, so it ends the way Escape does: one
   *  `close` event, whichever way it was asked for. */
  export function close() {
    dialog.close();
  }
</script>

<!-- A click that lands on the element itself, and not on anything in it, is
     on the backdrop: the dialog has no padding of its own. -->
<dialog
  bind:this={dialog}
  class:fit
  {onclose}
  onclick={(e) => e.target === dialog && dialog.close()}
>
  {@render children()}
</dialog>

<style>
  dialog {
    inset: 24px;
    width: auto;
    height: auto;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-panel);
    background: var(--s1);
    color: var(--fg);
    box-shadow: var(--shadow);
  }

  /* The user agent's own placement for a modal dialog — `inset: 0` with auto
     margins is what centres it — and the content decides the size, capped
     at the margin the full-window shape keeps. */
  dialog.fit {
    inset: 0;
    width: fit-content;
    height: fit-content;
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 48px);
    margin: auto;
    overflow: auto;
  }

  dialog::backdrop {
    background: var(--scrim);
  }

  /* Again the content and not a popover the content opened: the expanded
     inspector's picker is a child of this dialog. */
  dialog:not(.fit) > :global(*:not([popover])) {
    height: 100%;
  }
</style>
