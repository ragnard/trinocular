<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** Fired however the dialog closed: Escape, the backdrop, or `close()`. */
    onclose: () => void;
    children: Snippet;
  }

  let { onclose, children }: Props = $props();

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
<dialog bind:this={dialog} {onclose} onclick={(e) => e.target === dialog && dialog.close()}>
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

  dialog::backdrop {
    background: var(--scrim);
  }

  dialog > :global(*) {
    height: 100%;
  }
</style>
