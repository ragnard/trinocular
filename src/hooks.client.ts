import type { ClientInit } from "@sveltejs/kit";

export const init: ClientInit = async () => {
  console.log('init');
};
