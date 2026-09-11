<script lang="ts">
  import { Search, X } from "@lucide/svelte";

  interface Props {
    value?: string;
    placeholder?: string;
    /** What is being filtered, for assistive technology. */
    label: string;
  }

  let { value = $bindable(""), placeholder = "Filter…", label }: Props = $props();

  let input: HTMLInputElement | undefined = $state();

  function clear() {
    value = "";
    input?.focus();
  }
</script>

<div class="filter">
  <Search size={14} />
  <input
    type="text"
    {placeholder}
    bind:value
    bind:this={input}
    spellcheck="false"
    aria-label={label}
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
    gap: 8px;
    flex: none;
    height: var(--h-row);
    margin: 8px 12px 6px;
    padding: 0 4px 0 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r);
    color: var(--fg-3);
  }

  .filter:focus-within {
    border-color: var(--accent);
    color: var(--accent);
  }

  .filter input {
    flex: 1;
    min-width: 0;
    height: auto;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--fg);
  }

  .filter input:focus-visible {
    outline: none;
  }
</style>
