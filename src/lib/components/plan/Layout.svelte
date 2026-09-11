<script lang="ts">
  /**
   * Runs the layout once Svelte Flow has measured the cards. It has to be a
   * child of `<SvelteFlow>`, since that is where the store the hooks read
   * lives; a card's height is its rows, so nothing knows it before render.
   * Mounting a fresh one — the parent keys it on the plan — is what makes
   * a new plan lay out again.
   */
  import { useNodesInitialized, useSvelteFlow } from "@xyflow/svelte";
  import type { Point, Size } from "$lib/plan/layout";
  import { FIT } from "./fit";

  interface Props {
    place: (sizeOf: (id: string) => Size) => Map<string, Point>;
    onready: () => void;
  }

  let { place, onready }: Props = $props();

  const initialized = useNodesInitialized();
  const { getNodes, updateNode, fitView } = useSvelteFlow();
  let done = false;

  $effect(() => {
    if (!initialized.current || done) return;
    done = true;
    const sizes = new Map(
      getNodes().map((n) => [
        n.id,
        { width: n.measured?.width ?? 0, height: n.measured?.height ?? 0 }
      ])
    );
    const positions = place((id) => sizes.get(id) ?? { width: 0, height: 0 });
    for (const [id, position] of positions) updateNode(id, { position });
    fitView(FIT).then(onready);
  });
</script>
