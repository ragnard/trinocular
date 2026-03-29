<script lang="ts" module>
  import type { Field, DataType } from "./types";

  function formatCell(value: any, dataType: DataType): string {
    if (value === null || value === undefined) return "";
    if (Array.isArray(dataType)) {
      const n = Array.isArray(value) ? value.length : 0;
      return `[${n} item${n !== 1 ? "s" : ""}]`;
    }
    if (typeof dataType === "object" && "fields" in dataType) {
      const n = dataType.fields.length;
      return `{${n} field${n !== 1 ? "s" : ""}}`;
    }
    return String(value);
  }

  export { defaultCell }

</script>

{#snippet defaultCell(field: Field, value: any)}
  {formatCell(value, field.dataType)}
{/snippet}
