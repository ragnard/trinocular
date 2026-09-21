import type { Scenario } from "../scenario";
import { append } from "./append";
import { editor } from "./editor";
import { filter } from "./filter";
import { inspectorFlat, inspectorNested } from "./inspector";
import { leak } from "./leak";

export const scenarios: Scenario[] = [append, inspectorFlat, inspectorNested, leak, editor, filter];
