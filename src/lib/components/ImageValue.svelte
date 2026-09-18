<script lang="ts">
  /**
   * A varbinary drawn as the image it holds. An `<img>` on a data URL is
   * inert (no script runs inside one, SVG included), so unlike HTML this needs
   * no frame. It is drawn to fit the pane and a click shows it at its own
   * size, scrolling; the browser is the judge of whether the bytes are an
   * image, and the row says so when they are not.
   */
  let { src, title }: { src: string; title?: string } = $props();

  // Keyed on `src` rather than reset by an effect: the row reuses this
  // component when the value under it changes, and a verdict about the old
  // bytes must not outlive them.
  interface Loaded {
    src: string;
    width: number;
    height: number;
  }

  let failedSrc = $state<string | null>(null);
  let loaded = $state.raw<Loaded | null>(null);
  let failed = $derived(failedSrc === src);
  let size = $derived(loaded?.src === src ? loaded : null);

  let full = $state(false);

  /** `data:image/svg+xml;…` → `SVG`; the sniff's fallback reads as `image`. */
  let kind = $derived.by(() => {
    const type = src.slice(5, src.indexOf(";"));
    return type.startsWith("image/")
      ? type.slice(6).replace("+xml", "").replace("x-", "").toUpperCase()
      : "image";
  });

  function onload(event: Event) {
    const img = event.currentTarget as HTMLImageElement;
    loaded = { src, width: img.naturalWidth, height: img.naturalHeight };
  }
</script>

{#if failed}
  <span class="warn">Not an image the browser can draw</span>
{:else}
  <button
    class="image"
    class:full
    onclick={() => (full = !full)}
    title={full ? "Fit to pane" : "Show at full size"}
  >
    <img {src} alt={title} {onload} onerror={() => (failedSrc = src)} />
  </button>
  {#if size}
    <span class="meta">{kind} · {size.width} × {size.height}</span>
  {/if}
{/if}

<style>
  .image {
    display: block;
    max-width: 100%;
    max-height: 320px;
    overflow: hidden;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--r);
    background: var(--s0);
    cursor: zoom-in;
  }

  .image.full {
    max-height: none;
    overflow: auto;
    cursor: zoom-out;
  }

  img {
    display: block;
    max-width: 100%;
    max-height: 320px;
    object-fit: contain;
  }

  .full img {
    max-width: none;
    max-height: none;
  }

  .meta {
    display: block;
    margin-top: 4px;
  }
</style>
