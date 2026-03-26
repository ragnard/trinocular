import type { TypeSignature } from "$lib/trino";
import type { Field, DataType, Struct } from "./Table.svelte";

export function fieldFromTypeSignature(sig: TypeSignature, name: string, typeName: string): Field {
  return {
    name,
    dataType: toDataType(sig),
    dataTypeName: typeName,
    nullable: true,
  };
}

function toField(sig: TypeSignature, name: string): Field {
  return {
    name,
    dataType: toDataType(sig),
    dataTypeName: formatTypeName(sig),
    nullable: true,
  };
}

function formatTypeName(sig: TypeSignature): string {
  switch (sig.rawType) {
    case "row": {
      const fields = sig.arguments.map((arg, i) => {
        if (arg.kind !== "NAMED_TYPE") return `_${i}`;
        const name = arg.value.fieldName?.name ?? `_${i}`;
        return `${name} ${formatTypeName(arg.value.typeSignature)}`;
      });
      return `row(${fields.join(", ")})`;
    }
    case "array": {
      const typeArg = sig.arguments.find((a) => a.kind === "TYPE");
      if (typeArg && typeArg.kind === "TYPE") {
        return `array(${formatTypeName(typeArg.value)})`;
      }
      return "array";
    }
    default:
      return sig.rawType;
  }
}

function toDataType(sig: TypeSignature): DataType {
  switch (sig.rawType) {
    case "row": {
      const struct: Struct = {
        fields: sig.arguments.map((arg, i) => {
          if (arg.kind !== "NAMED_TYPE") {
            return toField({ rawType: "varchar", arguments: [] }, `_${i}`);
          }
          const fieldName = arg.value.fieldName?.name ?? `_${i}`;
          return toField(arg.value.typeSignature, fieldName);
        }),
      };
      return struct;
    }
    case "array": {
      const typeArg = sig.arguments.find((a) => a.kind === "TYPE");
      if (typeArg && typeArg.kind === "TYPE") {
        return [toDataType(typeArg.value)];
      }
      return ["string" as DataType];
    }
    case "integer":
    case "bigint":
    case "smallint":
    case "tinyint":
    case "double":
    case "real":
    case "decimal":
      return "integer";
    default:
      return "string";
  }
}
