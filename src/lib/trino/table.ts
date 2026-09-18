import type { TypeSignature } from "./index";
import { isDictionary, isList, isStruct } from "$lib/components/table/types";
import type { Field, DataType, Struct, Dictionary } from "$lib/components/table/types";

export function convertRow(row: any[], fields: Field[]): any[] {
  return row.map((value, i) => convertValue(value, fields[i].dataType));
}

export function convertValue(value: any, dataType: DataType): any {
  if (value === null || value === undefined) return value;
  if (dataType === "binary") {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  }
  if (isList(dataType) && Array.isArray(value)) {
    return value.map((v) => convertValue(v, dataType[0]));
  }
  if (isStruct(dataType) && Array.isArray(value)) {
    return value.map((v, i) => convertValue(v, dataType.fields[i].dataType));
  }
  if (isDictionary(dataType) && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, convertValue(v, dataType.value)])
    );
  }
  return value;
}

export function fieldFromTypeSignature(sig: TypeSignature, name: string, typeName: string): Field {
  return {
    name,
    dataType: toDataType(sig),
    dataTypeName: typeName,
    nullable: true
  };
}

function toField(sig: TypeSignature, name: string): Field {
  return {
    name,
    dataType: toDataType(sig),
    dataTypeName: formatTypeName(sig),
    nullable: true
  };
}

function typeArguments(sig: TypeSignature): TypeSignature[] {
  return sig.arguments.flatMap((a) => (a.kind === "TYPE" ? [a.value] : []));
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
    case "map": {
      const [key, value] = typeArguments(sig);
      if (key && value) {
        return `map(${formatTypeName(key)}, ${formatTypeName(value)})`;
      }
      return "map";
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
        })
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
    case "map": {
      const [key, value] = typeArguments(sig);
      const dictionary: Dictionary = {
        key: key ? toDataType(key) : "string",
        value: value ? toDataType(value) : "string"
      };
      return dictionary;
    }
    case "integer":
    case "bigint":
    case "smallint":
    case "tinyint":
    case "double":
    case "real":
    case "decimal":
      return "integer";
    case "varbinary":
      return "binary";
    default:
      return "string";
  }
}
