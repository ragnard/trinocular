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

export type DataType = "string" | "integer" | "binary" | Struct | List;

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
   * The cell the keyboard is on — the corner the selection grew from, or the
   * single cell when there is only one. The strip under the table reads it so
   * a value stays legible however narrow its column is.
   */
  getActive: () => { field: Field; value: any } | null;
}

export type CellRendererLookup = (field: Field) => Snippet<[Field, any]>;
