<script lang="ts">
  /**
   * A value as text, and how much of it. A single varchar can be megabytes,
   * a selection is a block of them, and the pane lays every row out
   * unvirtualised, so without a cap one cell decides how long the inspector
   * takes to draw. The cap is on the screen and not on the value: the row
   * says what it is holding back, `Show more` raises this one cell to a
   * larger cap, and the copy button beside it always hands over the whole
   * thing. Past the larger cap it is the browser, not the value, that you
   * would be waiting for.
   *
   * Expansion is remembered against the text rather than reset by an effect:
   * the row reuses this component when the value under it changes, and one
   * cell having turned out to be worth reading says nothing about the next.
   */
  const DISPLAY_LIMIT = 4_000;
  const EXPANDED_LIMIT = 500_000;

  interface Props {
    text: string;
    /** Whitespace is meaningful: the value goes in a `<pre>`. */
    pre?: boolean;
    /** Why what you asked for is not what you got. */
    note?: string;
    /** Off for text whose columns mean something, like a hex dump: it scrolls
     *  sideways instead of folding. */
    wrap?: boolean;
  }

  let { text, pre = false, note, wrap = true }: Props = $props();

  let expandedFor = $state<string | null>(null);
  let expanded = $derived(expandedFor === text);
  let limit = $derived(expanded ? EXPANDED_LIMIT : DISPLAY_LIMIT);
  let shown = $derived(text.length <= limit ? text : text.slice(0, limit));
  let truncated = $derived(shown.length < text.length);

  const count = (n: number) => n.toLocaleString();
</script>

<div class="mono">
  {#if pre}<pre class:nowrap={!wrap}>{shown}</pre>{:else}{shown}{/if}{#if truncated}&hellip;{/if}
</div>
{#if note || truncated}
  <p class="note meta">
    {#if note}<span class="warn">{note}</span>{/if}
    {#if truncated}
      <span>
        Showing {count(shown.length)} of {count(text.length)} characters
        {#if expanded}&mdash; copy for the whole value{/if}
      </span>
      {#if !expanded}
        <button class="more" onclick={() => (expandedFor = text)}>Show more</button>
      {/if}
    {/if}
  </p>
{/if}

<style>
  pre {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
  }

  pre.nowrap {
    white-space: pre;
    overflow-x: auto;
  }

  .note {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
    margin: 4px 0 0;
  }

  .warn {
    color: var(--error);
  }

  .more {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
</style>
