import type { Snippet } from "svelte";

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

/** A Trino map. Its keys arrive as the strings JSON object keys have to be. */
export interface Dictionary {
  key: DataType;
  value: DataType;
}

export type DataType = "string" | "integer" | "binary" | Struct | List | Dictionary;

export type ValueConverter = (value: any, field: Field, colIndex: number) => any;

export interface SelectionData {
  fields: Field[];
  rows: any[][];
}

export interface Selection {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  getData: () => SelectionData;
  /**
   * What the inspector calls the selection and each of its rows, for a
   * selection that is not a block of table cells — a plan operator is one
   * document, and "1 rows × 12 fields" over "Row 1" is not its name. A table
   * selection leaves both unset and gets the counts.
   */
  title?: string;
  rowTitle?: (row: number) => string;
}

export type CellRendererLookup = (field: Field) => Snippet<[Field, any]>;

/**
 * What the table needs of a collection of rows, which is only these three
 * things. A plain `any[][]` satisfies it, and so does `Rows` — the table does
 * not need to know that a result arrives in pages, only how to count rows and
 * cut a window out of them.
 */
export interface RowSource {
  readonly length: number;
  slice(start: number, end: number): any[][];
  [Symbol.iterator](): Iterator<any[]>;
}
