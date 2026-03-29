import type { Snippet } from "svelte";
import type { TypeSignature } from "$lib/trino";

export interface Schema {
  fields: Field[];
}

export interface Field {
  name: string;
  dataType: DataType;
  dataTypeName: string;
  nullable: boolean;
}

export interface Struct {
  fields: Field[];
}

export type List = DataType[];

export type DataType = "string" | "integer" | "binary" | Struct | List;

export interface TableData {
  schema: Schema;
  data: any[][];
}

export interface Selection {
  fields: Field[];
  rows: any[][];
}

export type CellRendererLookup = (field: Field) => Snippet<[Field, any]>;

export function convertRow(row: any[], fields: Field[]): any[] {
  return row.map((value, i) => convertValue(value, fields[i].dataType));
}

function convertValue(value: any, dataType: DataType): any {
  if (value === null || value === undefined) return value;
  if (dataType === "binary") {
    return Uint8Array.fromBase64(value);
  }
  if (Array.isArray(dataType) && Array.isArray(value)) {
    return value.map((v) => convertValue(v, dataType[0]));
  }
  if (typeof dataType === "object" && "fields" in dataType && Array.isArray(value)) {
    return value.map((v, i) => convertValue(v, dataType.fields[i].dataType));
  }
  return value;
}

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
    case "varbinary":
      return "binary";
    default:
      return "string";
  }
}
