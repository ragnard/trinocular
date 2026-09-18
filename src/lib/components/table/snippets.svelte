<script lang="ts" module>
  import { isDictionary, isList, isStruct, type DataType, type Field } from "./types";

  const HEX_CELL_BYTES = 256;

  function hex(bytes: Uint8Array): string {
    const shown = bytes.subarray(0, HEX_CELL_BYTES);
    let out = "0x";
    for (const b of shown) out += b.toString(16).padStart(2, "0");
    return bytes.length > shown.length ? out + "…" : out;
  }

  function formatCell(value: any, dataType: DataType): string {
    if (value === null || value === undefined) return "";
    if (dataType === "binary" && value instanceof Uint8Array) return hex(value);
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

  export { defaultCell, formatCell };
</script>

{#snippet defaultCell(field: Field, value: any)}
  {formatCell(value, field.dataType)}
{/snippet}
