import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const error = await locals.session?.take<{ requestId: string }>("auth-error");
  return { requestId: error?.requestId ?? null };
};
