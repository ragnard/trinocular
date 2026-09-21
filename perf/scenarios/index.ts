import type { Scenario } from "../scenario";
import { append } from "./append";
import { editor } from "./editor";
import { filter } from "./filter";
import { inspectorFlat, inspectorNested } from "./inspector";
import { leak } from "./leak";
import { record } from "./record";

export const scenarios: Scenario[] = [
  append,
  inspectorFlat,
  inspectorNested,
  record,
  leak,
  editor,
  filter
];
