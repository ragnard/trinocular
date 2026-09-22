<script lang="ts">
  import Application from "$lib/components/Application.svelte";
  import { Workspace } from "$lib/State.svelte";
  import { page } from "$app/state";
  import { afterNavigate, replaceState } from "$app/navigation";
  import { linkedQuery, withoutLinkParams } from "$lib/openLink";

  const workspace = new Workspace(
    page.data.connections,
    page.data.store,
    page.data.loaded,
    page.data.results
  );

  // A link carrying `?sql=` opens it as a new document, here rather than in a
  // component: `Editor.svelte` builds a monaco model from `SqlFile.content`
  // once and caches it against the `SqlFile`, after which the model is the
  // truth and writing to `content` would not reach the screen. So the document
  // has to exist, with its text, before anything renders.
  const linked = linkedQuery(page.url.searchParams);
  if (linked?.ok) workspace.openLinkedFile(linked.sql, linked.name);

  // What a refused link says. It is not thrown away silently, because the
  // alternative to saying so is an empty editor that reads as a link that
  // worked.
  const refusal = linked && !linked.ok ? linked.reason : null;

  // The parameters come off the address bar once they have been read. A
  // reload would otherwise open the query a second time, and the SQL — which
  // is somebody's data as often as not — would sit in the session history for
  // the rest of the day. Kit's `replaceState` rather than the platform's, so
  // the router keeps its own state in step, and from `afterNavigate`, which
  // runs on mount, because `replaceState` refuses to be called before the
  // router has started. Shallow routing raises no navigation of its own, so
  // this does not come back round.
  afterNavigate(() => {
    if (!linked) return;
    const url = withoutLinkParams(page.url);
    if (url.href !== page.url.href) replaceState(url, page.state);
  });
</script>

<Application {workspace} linkRefusal={refusal} />
