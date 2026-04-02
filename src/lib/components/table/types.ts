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
}

export type CellRendererLookup = (field: Field) => Snippet<[Field, any]>;
