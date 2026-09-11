<script lang="ts">
  /**
   * A distributed plan as a graph of its fragments, drawn with Svelte Flow.
   *
   * Svelte Flow is here for what a hand-rolled canvas would have to grow
   * anyway — pan, zoom, fit-to-view, and edges that start and end on measured
   * points inside a node — and for nothing else: the layout is ours
   * (`layoutFragments`), the cards are ordinary components, and every
   * editing affordance is switched off. Selection is an operator row, not a
   * node, so Svelte Flow's own selection is off too and the rows talk to
   * `PlanSelection` through context instead.
   */
  import { MarkerType, Panel, SvelteFlow, type Edge, type Node } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/base.css";
  import { setContext } from "svelte";
  import { edgesOf, fragmentsOf, type Fragment } from "$lib/plan/fragments";
  import { layoutFragments } from "$lib/plan/layout";
  import type { DistributedPlan, PlanNode } from "$lib/plan/types";
  import FitButton from "./FitButton.svelte";
  import FragmentNode from "./FragmentNode.svelte";
  import Layout from "./Layout.svelte";
  import { PLAN_SELECTION, PlanSelection } from "./selection.svelte";

  interface Props {
    plan: DistributedPlan;
    /** The operator to start with picked out, by node id. */
    selected?: string | null;
    onselect?: (node: PlanNode, fragmentId: string) => void;
  }

  let { plan, selected = null, onselect }: Props = $props();

  const selection = new PlanSelection((node, fragmentId) => onselect?.(node, fragmentId));
  setContext(PLAN_SELECTION, selection);
  $effect(() => {
    selection.id = selected;
  });

  const nodeTypes = { fragment: FragmentNode };

  let fragments = $derived(fragmentsOf(plan));
  let fragmentEdges = $derived(edgesOf(fragments));

  // Bound, because Svelte Flow writes measurements back into them. Rebuilt
  // from scratch for a new plan; the cards are cheap and the ids may collide.
  let nodes: Node<{ fragment: Fragment }>[] = $state.raw([]);
  let edges: Edge[] = $state.raw([]);
  let ready = $state(false);

  $effect(() => {
    ready = false;
    nodes = fragments.map((fragment) => ({
      id: fragment.id,
      type: "fragment",
      position: { x: 0, y: 0 },
      data: { fragment },
      draggable: false,
      selectable: false,
      connectable: false
    }));
    edges = fragmentEdges.map((edge) => ({
      id: `${edge.from}->${edge.into}`,
      source: edge.from,
      sourceHandle: "out",
      target: edge.to,
      targetHandle: `in-${edge.into}`,
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }
    }));
  });
</script>

<div class="graph" class:ready>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    nodesDraggable={false}
    nodesConnectable={false}
    elementsSelectable={false}
    nodesFocusable={false}
    edgesFocusable={false}
    zoomOnDoubleClick={false}
    minZoom={0.25}
    maxZoom={2}
  >
    {#key fragments}
      <Layout
        place={(sizeOf) => layoutFragments(fragments, fragmentEdges, sizeOf)}
        onready={() => (ready = true)}
      />
    {/key}
    <Panel position="top-right">
      <FitButton />
    </Panel>
  </SvelteFlow>
</div>

<style>
  .graph {
    height: 100%;
    opacity: 0;
    transition: opacity 120ms ease-out;
  }

  .graph.ready {
    opacity: 1;
  }

  /* Only the primitives Svelte Flow draws itself take its variables — the
     pane, the edges, the arrowheads. The cards are ours and use the app's. */
  .graph :global(.svelte-flow) {
    --xy-background-color-default: var(--s0);
    --xy-edge-stroke-default: var(--fg-3);
    --xy-edge-stroke-width-default: 1.5;
    --xy-edge-stroke-selected-default: var(--accent);
    --xy-handle-background-color-default: transparent;
    --xy-attribution-background-color-default: transparent;
  }

  .graph :global(.svelte-flow__attribution a) {
    color: var(--fg-3);
  }

  /* reset.css gives every svg `max-width: 100%`. Svelte Flow draws each edge in
     an unsized svg inside a zero-width absolute container, which that rule
     collapses to nothing — the edges were all there and none of them painted. */
  .graph :global(.svelte-flow__edges svg) {
    max-width: none;
  }

  .graph :global(.svelte-flow__arrowhead polyline) {
    fill: var(--fg-3);
    stroke: var(--fg-3);
  }

  .graph :global(.svelte-flow__panel) {
    margin: 8px;
  }
</style>
