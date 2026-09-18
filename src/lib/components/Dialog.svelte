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

  /** Goes through the element's own close so focus returns to where it was. */
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
    width: calc(100vw - 48px);
    height: calc(100vh - 48px);
    max-width: none;
    max-height: none;
    inset: 0;
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-panel);
    background: var(--s1);
    color: var(--fg);
    box-shadow: var(--shadow);
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.45);
  }

  dialog > :global(*) {
    height: 100%;
  }
</style>
