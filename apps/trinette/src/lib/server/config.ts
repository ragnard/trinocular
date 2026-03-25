// import fs from "fs";
// import path from "path";
// import { logger } from "./logging";
// import { env } from "$env/dynamic/private";

import { type } from "arktype"

export const Connection = type({
  id: "string",
  name: "string",
  uri: "string.url",
});
