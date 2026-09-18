/**
 * Measures text in an element's font without laying anything out, which is
 * what sizing a column to two hundred rows of content needs.
 */
export function textMeasurer(element: Element): (text: string) => number {
  const context = document.createElement("canvas").getContext("2d")!;
  const s = getComputedStyle(element);
  context.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  return (text) => context.measureText(text).width;
}
