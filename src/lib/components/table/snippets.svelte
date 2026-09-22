<script lang="ts" module>
  import type { Field } from "./types";
  import { NULL_TEXT, formatCell, isNull } from "./format";

  export { defaultCell };
</script>

{#snippet defaultCell(field: Field, value: any)}{#if isNull(value)}<span class="muted"
      >{NULL_TEXT}</span
    >{:else}{formatCell(value, field.dataType)}{/if}{/snippet}
