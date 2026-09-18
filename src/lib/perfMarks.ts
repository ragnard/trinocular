/**
 * User Timing marks at the points a performance run measures between: a page
 * appended to a result, a result settling, an editor edit, the inspector
 * having drawn a selection. They show up as a track in the DevTools
 * Performance panel and are what `perf/` measures against, so the anchors are
 * the app's own rather than a driver's guess at when something happened.
 */
export const MARK = {
  resultPage: "trinette:result:page",
  resultSettled: "trinette:result:settled",
  editorChange: "trinette:editor:change",
  inspectorRendered: "trinette:inspector:rendered"
} as const;

export function mark(name: (typeof MARK)[keyof typeof MARK], detail?: Record<string, unknown>) {
  performance.mark(name, detail && { detail });
}
