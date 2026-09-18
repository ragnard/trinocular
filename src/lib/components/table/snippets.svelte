<script lang="ts" module>
  import { isDictionary, isList, isStruct, type DataType, type Field } from "./types";

  function formatCell(value: any, dataType: DataType): string {
    if (value === null || value === undefined) return "";
    if (isList(dataType)) {
      const n = Array.isArray(value) ? value.length : 0;
      return `[${n} item${n !== 1 ? "s" : ""}]`;
    }
    if (isStruct(dataType)) {
      const n = dataType.fields.length;
      return `{${n} field${n !== 1 ? "s" : ""}}`;
    }
    if (isDictionary(dataType)) {
      const n = typeof value === "object" ? Object.keys(value).length : 0;
      return `{${n} ${n !== 1 ? "entries" : "entry"}}`;
    }
    return String(value);
  }

  export { defaultCell };
</script>

{#snippet defaultCell(field: Field, value: any)}
  {formatCell(value, field.dataType)}
{/snippet}
