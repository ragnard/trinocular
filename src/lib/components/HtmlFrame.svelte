<script lang="ts" module>
  const TOKENS = [
    "--font",
    "--font-mono",
    "--text",
    "--leading",
    "--fg",
    "--fg-2",
    "--accent",
    "--line",
    "--s2"
  ];

  /**
   * One stylesheet per palette, for every frame on the page: two hundred HTML
   * cells in a selection are two hundred frames, and each used to read the
   * root's computed style for itself. Cached only once the root actually
   * wears the palette asked for, since a sheet read a beat early would carry
   * the other theme's colours for the rest of the session.
   */
  const sheets = new Map<string, string>();

  function stylesheet(palette: string): string {
    const cached = sheets.get(palette);
    if (cached) return cached;
    const sheet = build(palette);
    if (document.documentElement.dataset.theme === palette) sheets.set(palette, sheet);
    return sheet;
  }

  function build(palette: string): string {
    const style = getComputedStyle(document.documentElement);
    const v = Object.fromEntries(TOKENS.map((t) => [t, style.getPropertyValue(t).trim()]));
    return [
      `:root{color-scheme:${palette}}`,
      `body{margin:8px 12px;font:${v["--text"]}/${v["--leading"]} ${v["--font"]};color:${v["--fg"]};overflow-wrap:anywhere}`,
      `a{color:${v["--accent"]}}`,
      `pre,code{font-family:${v["--font-mono"]};font-size:0.95em}`,
      `pre{padding:8px 12px;background:${v["--s2"]};border-radius:6px;overflow:auto}`,
      `img{max-width:100%}`,
      `table{border-collapse:collapse}`,
      `th,td{padding:2px 8px;border:1px solid ${v["--line"]};text-align:left}`,
      `blockquote{margin:0;padding-left:12px;border-left:3px solid ${v["--line"]};color:${v["--fg-2"]}}`,
      `h1,h2,h3,h4{font-weight:600}`
    ].join("\n");
  }
</script>

<script lang="ts">
  /**
   * A document from a result cell, drawn in a frame with an empty `sandbox`:
   * no script, no forms, no navigating anything, and an opaque origin, so the
   * document can reach neither this page nor the session behind it. It also
   * carries a policy of its own under which it may request nothing at all.
   *
   * The frame is its own document and inherits nothing, so the pane's palette
   * and type are read off the root and written in as a stylesheet — after
   * `tick`, since the theme lands on `<html>` in an ancestor's effect and this
   * one has to see it land. A document's own styles come after and win.
   *
   * Its height is not the document's: nothing sandboxed this tightly can be
   * measured from outside, so the box is a fixed height with a resize grip,
   * which is also what keeps one value from deciding the height of the pane.
   */
  import { tick } from "svelte";
  import { theme } from "$lib/theme.svelte";

  let { html, title }: { html: string; title?: string } = $props();

  // Read once up front, so the first document already carries it, and again
  // whenever the palette changes. An unchanged string is not a change, so a
  // frame is only ever reloaded when its stylesheet actually differs.
  let base = $state(stylesheet(theme.resolved));

  $effect(() => {
    const palette = theme.resolved;
    void tick().then(() => (base = stylesheet(palette)));
  });

  /**
   * The document's own policy, on top of the page's, which it inherits and
   * can only tighten: nothing may be requested at all. Inline styles are
   * allowed because the base stylesheet is one and a document's own usually
   * are; a `data:` image is allowed because it is bytes already here, not a
   * request. First in the head, since a meta policy governs what follows it.
   */
  const CSP =
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

  let srcdoc = $derived(
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta charset="utf-8"><style>${base}</style></head><body>${html}</body></html>`
  );
</script>

<div class="frame">
  <iframe {title} {srcdoc} sandbox="" referrerpolicy="no-referrer"></iframe>
</div>

<style>
  .frame {
    height: 240px;
    min-height: 48px;
    max-height: 80vh;
    resize: vertical;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--r);
    background: var(--s0);
  }

  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>
