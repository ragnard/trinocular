<script lang="ts">
  import { Search, X } from "@lucide/svelte";

  interface Props {
    value?: string;
    placeholder?: string;
    /** What is being filtered, for assistive technology. */
    label: string;
    /** The text is not a usable filter (a regex that will not compile). */
    invalid?: boolean;
    title?: string;
  }

  let {
    value = $bindable(""),
    placeholder = "Filter…",
    label,
    invalid = false,
    title
  }: Props = $props();

  let input: HTMLInputElement | undefined = $state();

  export function focus() {
    input?.focus();
  }

  function clear() {
    value = "";
    input?.focus();
  }
</script>

<div class="filter" class:invalid {title}>
  <Search size={14} />
  <input
    type="text"
    {placeholder}
    bind:value
    bind:this={input}
    spellcheck="false"
    aria-label={label}
    aria-invalid={invalid}
    onkeydown={(e) => {
      if (e.key === "Escape" && value) {
        e.preventDefault();
        clear();
      }
    }}
  />
  {#if value}
    <button class="chip square" onclick={clear} title="Clear filter" aria-label="Clear filter">
      <X size={14} />
    </button>
  {/if}
</div>

<style>
  .filter {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    height: var(--h-row);
    padding: 0 4px 0 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r);
    background: var(--s0);
    color: var(--fg-3);
  }

  .filter:focus-within {
    border-color: var(--accent);
    color: var(--accent);
  }

  .filter.invalid {
    border-color: var(--error);
  }

  .filter input {
    flex: 1;
    color: var(--fg);
  }
</style>
