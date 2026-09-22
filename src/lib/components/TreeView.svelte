<script lang="ts" module>
  import type { Snippet } from "svelte";

  export interface TreeNode {
    id: string;
    label: string;
    detail?: string;
    /**
     * The whole truth behind a row that had to be shortened, on hover. A nested
     * row's type runs to hundreds of characters, so the tree shows `row`
     * rather than taking its width from the worst column in the schema — and
     * deep enough in, the ellipsis falls on the label instead.
     */
    hint?: string;
    children?: TreeNode[];
    /** Offers the reload button. Only nodes whose children come from somewhere are. */
    reloadable?: boolean;
  }

  const NONE: ReadonlySet<string> = new Set();
  const NO_ERRORS: ReadonlyMap<string, string> = new Map();

  /** A branch draws its children only while open and only when it has some. */
  function isExpanded(node: TreeNode, expanded: Set<string>): boolean {
    return node.children !== undefined && node.children.length > 0 && expanded.has(node.id);
  }

  /** The ids of every row on screen, in the order they are drawn. */
  function visibleIds(nodes: TreeNode[], expanded: Set<string>, out: string[] = []): string[] {
    for (const node of nodes) {
      out.push(node.id);
      if (isExpanded(node, expanded)) visibleIds(node.children!, expanded, out);
    }
    return out;
  }

  /**
   * Arrow keys walk the rows the DOM holds rather than the nodes: a closed
   * branch renders no children, so every `treeitem` in document order is a
   * visible row and the next one down is simply the next one, whatever depth
   * it sits at. That saves each level of the recursion from having to know
   * where its neighbours' subtrees begin and end.
   */
  function rowsOf(item: HTMLElement): HTMLElement[] {
    const tree = item.closest('[role="tree"]') ?? item;
    return Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  }

  function step(item: HTMLElement, by: number): HTMLElement | undefined {
    const rows = rowsOf(item);
    return rows[rows.indexOf(item) + by];
  }

  function parentOf(item: HTMLElement): HTMLElement | null {
    // From the group `ul` that holds this row, so the row does not find itself.
    return item.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? null;
  }
</script>

<script lang="ts">
  import { ChevronRight, LoaderCircle, RefreshCw } from "@lucide/svelte";
  import TreeView from "./TreeView.svelte";

  interface Props {
    nodes: TreeNode[];
    /**
     * Which branches are open — the whole truth, owned by the caller. It lives
     * outside this component because a filter rebuilds `nodes`, and with it
     * these component instances; state kept in here would be lost on every
     * filter and clear. Keeping it the only input to `isOpen` is also what
     * stops the chevron from lying: whatever it draws, clicking changes.
     */
    expanded: Set<string>;
    /**
     * Status, by node id, kept apart from the nodes on purpose: a spinner
     * starting on one row must not rebuild the tree — with a few thousand
     * columns loaded, that rebuild re-parses every one of their types.
     */
    loading?: ReadonlySet<string>;
    /** Why the last attempt to fill a node's children failed; drawn under the row while it is open. */
    errors?: ReadonlyMap<string, string>;
    /** What the tree is a tree of, for assistive technology. */
    label?: string;
    ontoggle: (node: TreeNode) => void;
    onclick?: (node: TreeNode) => void;
    onreload?: (node: TreeNode) => void;
    icon?: Snippet<[TreeNode]>;
    /**
     * Per-row controls, revealed on hover beside the reload button. The
     * snippet decides which rows get any; an empty render costs nothing. The
     * second argument is the `tabindex` its buttons must carry: the tree is one
     * tab stop, and only the row holding it lets Tab reach its buttons.
     */
    actions?: Snippet<[TreeNode, number]>;
    /**
     * What a copy puts on the clipboard for the row that has focus, by id.
     * The tree does not know what its rows name, the same way `Table` does not
     * know what a Trino value is: the caller answers. Without it the browser's
     * own copy stands, which for rows that are `user-select: none` is nothing.
     */
    clipboardText?: (id: string) => string | undefined;
    /** Recursion only: how deep this instance sits, where the tab stop is, and which row is current. */
    depth?: number;
    tabbable?: string;
    selected?: string | null;
    onfocusrow?: (id: string) => void;
  }

  let {
    nodes,
    expanded,
    loading = NONE,
    errors = NO_ERRORS,
    label,
    ontoggle,
    onclick,
    onreload,
    icon,
    actions,
    clipboardText,
    depth = 0,
    tabbable: nestedTabbable,
    selected: nestedSelected,
    onfocusrow: nestedFocusRow
  }: Props = $props();

  const uid = $props.id();

  /**
   * The one tab stop, remembered by the root instance: the row last focused,
   * while it is still on screen, and the first row otherwise. The rows are
   * walked here rather than tracked per level so a filter that drops the
   * focused row hands the stop to whatever is left without any instance
   * having to notice its own removal. The nested instances are told.
   */
  let current: string | null = $state(null);
  let ids = $derived(depth === 0 ? visibleIds(nodes, expanded) : []);
  let tabbable = $derived(
    depth > 0 ? nestedTabbable : current !== null && ids.includes(current) ? current : ids[0]
  );
  /**
   * The current row: the one a copy takes and the one an arrow key moves from.
   * It is `current` and not `tabbable`, which falls back to the first row so
   * that Tab always has somewhere to land — drawing *that* as chosen would
   * have the tree open with its first catalog selected by nobody.
   */
  let selected = $derived(depth > 0 ? (nestedSelected ?? null) : current);

  function onfocusrow(id: string) {
    if (depth > 0) nestedFocusRow?.(id);
    else current = id;
  }

  /**
   * Focus arriving in a row, including on its own reload and action buttons —
   * which is why this is `focusin` rather than `focus`. It bubbles, so a row
   * nested under this one would otherwise claim it: the row a target belongs
   * to is the nearest `treeitem` above it, and that has to be this one.
   */
  function handleFocusIn(e: FocusEvent, node: TreeNode) {
    if (!(e.target instanceof HTMLElement)) return;
    if (e.target.closest('[role="treeitem"]') !== e.currentTarget) return;
    onfocusrow(node.id);
  }

  /**
   * A click on a row: the treeitem takes focus, and then the click does what
   * it always did. Browsers do focus the nearest focusable ancestor of a
   * mousedown themselves, but which row is current — and so what a copy takes
   * — would be resting on a behaviour nothing here states.
   */
  function handleRowClick(e: MouseEvent, node: TreeNode) {
    (e.currentTarget as HTMLElement).closest<HTMLElement>('[role="treeitem"]')?.focus();
    activate(node);
  }

  /** The root `ul`, for telling this tree's rows from another tree's. */
  let root: HTMLElement | undefined = $state();

  /**
   * A copy — Ctrl/⌘C, the Edit menu, the context menu — while a row has focus.
   * Answered on the *document* and not on the tree because Chromium fires
   * `copy` at the focused element while Firefox fires it at the text
   * selection's node, `<body>` when there is none. There never is one here:
   * the rows are `user-select: none`, so nothing of the browser's own is being
   * overridden either. `Table` answers the event in the same place, and was
   * where the Firefox half of this was found.
   *
   * Listened for by the root instance alone, and in an effect rather than
   * through `<svelte:document>`, which every instance in the recursion would
   * register: a tree with a few hundred branches open is a few hundred
   * instances, and all but one of them would have nothing to say. The root is
   * also the only one that could answer — its `current` is where every row's
   * focus is reported to.
   */
  function handleCopy(event: ClipboardEvent) {
    if (!clipboardText || !event.clipboardData || selected === null) return;
    // The row, or a button inside it: focus on either is what the current row
    // is drawn from, so it is what a copy follows.
    const row = document.activeElement?.closest('[role="treeitem"]');
    if (!row || !root?.contains(row)) return;
    const text = clipboardText(selected);
    if (text === undefined) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  }

  $effect(() => {
    if (depth > 0) return;
    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  });

  function activate(node: TreeNode) {
    if (node.children === undefined) onclick?.(node);
    else ontoggle(node);
  }

  /**
   * The ARIA tree pattern: up and down between rows, right to open a branch
   * and then to step into it, left to shut one and then to step out to its
   * parent, Home and End for the ends, Enter and Space for what a click does.
   * Only the row's own key presses: one from a button in the row, or from a
   * row nested under this one, has bubbled here and is somebody else's.
   */
  function handleKeydown(e: KeyboardEvent, node: TreeNode) {
    if (e.target !== e.currentTarget) return;
    const item = e.currentTarget as HTMLElement;
    const isLeaf = node.children === undefined;
    const isOpen = expanded.has(node.id);
    switch (e.key) {
      case "ArrowDown":
        step(item, 1)?.focus();
        break;
      case "ArrowUp":
        step(item, -1)?.focus();
        break;
      case "ArrowRight":
        if (isLeaf) break;
        if (!isOpen) ontoggle(node);
        else item.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
        break;
      case "ArrowLeft":
        if (!isLeaf && isOpen) ontoggle(node);
        else parentOf(item)?.focus();
        break;
      case "Home":
        rowsOf(item)[0]?.focus();
        break;
      case "End":
        rowsOf(item).at(-1)?.focus();
        break;
      case "Enter":
      case " ":
        activate(node);
        break;
      default:
        return;
    }
    e.preventDefault();
  }
</script>

<ul
  class="tree"
  class:nested={depth > 0}
  bind:this={root}
  role={depth > 0 ? "group" : "tree"}
  aria-label={label}
>
  {#each nodes as node, i (node.id)}
    {@const isLeaf = node.children === undefined}
    {@const isOpen = expanded.has(node.id)}
    {@const isLoading = loading.has(node.id)}
    {@const error = errors.get(node.id)}
    {@const isCurrent = node.id === tabbable}
    {@const isSelected = node.id === selected}
    {@const rowId = `${uid}-${i}`}
    <!-- Named by the label alone: a treeitem's name is otherwise computed
         from everything inside it, which for an open catalog is every
         schema and table beneath. Selection follows focus — there is no
         other sense in which a row here is chosen. -->
    <li
      class="node"
      class:leaf={isLeaf}
      class:current={isSelected}
      role="treeitem"
      aria-selected={isSelected}
      aria-labelledby="{rowId}-label"
      aria-describedby={isOpen && error ? `${rowId}-error` : undefined}
      aria-expanded={isLeaf ? undefined : isOpen}
      aria-level={depth + 1}
      aria-busy={isLoading}
      tabindex={isCurrent ? 0 : -1}
      onfocusin={(e) => handleFocusIn(e, node)}
      onkeydown={(e) => handleKeydown(e, node)}
    >
      <div class="row">
        <!-- The keys are on the treeitem, above; this is the pointer's half.
             Not a button: the row that holds focus is the treeitem, and a
             second focusable thing inside it would be a second tab stop. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="label"
          id="{rowId}-label"
          title={node.hint}
          onclick={(e) => handleRowClick(e, node)}
        >
          {#if isLeaf}
            <ChevronRight size={12} style="visibility: hidden;" />
          {:else if isLoading}
            <LoaderCircle size={12} class="spin" />
          {:else}
            <ChevronRight size={12} class={isOpen ? "toggle open" : "toggle"} />
          {/if}
          {#if icon}{@render icon(node)}{/if}
          <span class="node-label">{node.label}</span>
          {#if node.detail}
            <span class="node-detail meta">{node.detail}</span>
          {/if}
        </div>
        {#if actions}
          <span class="actions">{@render actions(node, isCurrent ? 0 : -1)}</span>
        {/if}
        {#if onreload && !isLeaf && node.reloadable}
          <button
            class="reload"
            title="Reload"
            aria-label="Reload {node.label}"
            tabindex={isCurrent ? 0 : -1}
            disabled={isLoading}
            onclick={() => onreload(node)}
          >
            <RefreshCw size={12} />
          </button>
        {/if}
      </div>
      {#if isOpen && error}
        <div class="node-error small warn" id="{rowId}-error">{error}</div>
      {/if}
      {#if isExpanded(node, expanded)}
        <TreeView
          nodes={node.children!}
          {expanded}
          {loading}
          {errors}
          {ontoggle}
          {onclick}
          {onreload}
          {icon}
          {actions}
          depth={depth + 1}
          {tabbable}
          {selected}
          {onfocusrow}
        />
      {/if}
    </li>
  {/each}
</ul>

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tree.nested {
    padding-left: 14px;
  }

  .node {
    margin: 0;
    padding: 0;
  }

  /* Focus is on the treeitem, whose box is the whole subtree once open; the
     ring is drawn on the row, which is what the focus means. */
  .node:focus-visible {
    outline: none;
  }

  .node:focus-visible > .row {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .row {
    display: flex;
    align-items: center;
    height: var(--h-tree);
    border-radius: var(--r);
  }

  .row:hover {
    background: var(--s2);
  }

  /* The current row: what a copy takes, and where Tab comes back to. Accent
     while the tree holds focus, since that is when it is the copy's subject —
     the ground the table draws a selected cell on. A quiet step up the ramp
     otherwise, so a tree you have left still shows where you are parked
     without claiming a selection the keyboard would not act on. Both outrank
     the hover above on specificity, which is what keeps hovering the current
     row from washing it back down to `--s2`. */
  .node.current > .row {
    background: var(--s3);
  }

  .tree:focus-within .node.current > .row {
    background: var(--accent-bg);
  }

  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 8px;
    border-radius: var(--r);
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }

  /* Icons are furniture until they mean something. */
  .row :global(svg) {
    flex: none;
    color: var(--fg-3);
  }

  .reload,
  .actions :global(button) {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 20px;
    height: 20px;
    margin-right: 4px;
    padding: 0;
    border: none;
    border-radius: var(--r-kbd);
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0;
  }

  /* Revealed on hover, on the focused row — where Tab will reach them — and
     while one of them holds focus. */
  .row:hover .reload,
  .node:focus-visible > .row .reload,
  .reload:focus-visible {
    opacity: 1;
  }

  /* Same reveal as the reload button, and held while a menu one of them
     opened is up — the pointer is on the menu by then, not the row. */
  .actions {
    display: contents;
  }

  .actions :global(button) {
    opacity: 0;
  }

  .row:hover .actions :global(button),
  .node:focus-visible > .row .actions :global(button),
  .actions :global(button:focus-visible),
  .actions :global(button[aria-pressed="true"]) {
    opacity: 1;
  }

  .reload:hover:enabled :global(svg),
  .actions :global(button:hover svg),
  .actions :global(button[aria-pressed="true"] svg) {
    color: var(--fg);
  }

  .reload:disabled {
    cursor: default;
  }

  .node-error {
    padding: 2px 8px 6px 46px;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .node-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .node-detail {
    flex: none;
    margin-left: auto;
    padding-left: 8px;
  }

  /* Scoped under the row: `.toggle` is too plain a name to own globally. */
  .label :global(.toggle) {
    transition: transform 0.12s ease;
  }

  .label :global(.toggle.open) {
    transform: rotate(90deg);
  }
</style>
