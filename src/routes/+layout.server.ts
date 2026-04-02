import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    claims: locals.claims,
    userId: locals.userId
  };
};
