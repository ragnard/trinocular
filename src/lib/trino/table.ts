import type { TypeSignature, Columns } from "./index";
import type { Field, DataType, Schema, Struct, Dictionary } from "$lib/components/table/types";

/** How Trino sends varbinary, and how it goes back out in a file. */
export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In slices: spreading a whole value into `fromCharCode` is one argument per
  // byte, and a varbinary can be larger than the stack allows arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Whether values of this type arrive in a form other than the one they are
 * held in. Only binary does: everything else Trino sends is already the JSON
 * value the table, the inspector and the exporters read.
 */
function needsConversion(dataType: DataType): boolean {
  if (dataType === "binary") return true;
  if (Array.isArray(dataType)) return needsConversion(dataType[0]);
  if (typeof dataType === "object") {
    return "fields" in dataType
      ? dataType.fields.some((field) => needsConversion(field.dataType))
      : needsConversion(dataType.value);
  }
  return false;
}

/**
 * Converts a page of rows in place, once, as it arrives — so a value is
 * decoded when it is received rather than each time it is drawn, and the rows
 * everything downstream reads are the same rows. Undefined when no column
 * needs it, which is most results, so those pages are never walked.
 */
export function pageConverter(fields: Field[]): ((page: any[][]) => void) | undefined {
  const columns = fields.flatMap((field, i) => (needsConversion(field.dataType) ? [i] : []));
  if (columns.length === 0) return undefined;
  return (page) => {
    for (const row of page) {
      for (const i of columns) row[i] = convertValue(row[i], fields[i].dataType);
    }
  };
}

export function convertValue(value: any, dataType: DataType): any {
  if (value === null || value === undefined) return value;
  if (dataType === "binary") {
    return fromBase64(value);
  }
  if (Array.isArray(dataType) && Array.isArray(value)) {
    return value.map((v) => convertValue(v, dataType[0]));
  }
  if (typeof dataType === "object" && "fields" in dataType && Array.isArray(value)) {
    return value.map((v, i) => convertValue(v, dataType.fields[i].dataType));
  }
  if (typeof dataType === "object" && "key" in dataType && typeof value === "object") {
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

export function schemaFromColumns(columns: Columns): Schema {
  return {
    fields: columns.map((col) => fieldFromTypeSignature(col.typeSignature, col.name, col.type))
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
