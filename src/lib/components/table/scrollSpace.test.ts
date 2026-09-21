import { describe, expect, test } from "bun:test";
import { MAX_SCROLL_HEIGHT, offsetOf, pageAt, pageAtThumb, scrollSpace } from "./scrollSpace";

const ROW = 30;

describe("scrollSpace", () => {
  test("under the cap, scroll space is row space and nothing is offset", () => {
    const space = scrollSpace(1000, ROW);
    expect(space.height).toBe(30_000);
    expect(space.pages).toBe(1);
    expect(space.jump).toBe(0);
    expect(pageAt(space, 15_000)).toBe(0);
    expect(offsetOf(space, 0)).toBe(0);
    expect(pageAtThumb(space, 100, 500)).toBe(0);
  });

  test("an empty result does not divide by zero", () => {
    const space = scrollSpace(0, ROW);
    expect(pageAt(space, 0)).toBe(0);
    expect(pageAtThumb(space, 0, 500)).toBe(0);
    expect(offsetOf(space, 0)).toBe(0);
  });

  // The counts from #49: what Firefox and Chrome could not reach, and beyond.
  for (const rows of [600_000, 1_500_000, 10_000_000]) {
    test(`${rows} rows page through a capped scroll space`, () => {
      const space = scrollSpace(rows, ROW);
      expect(space.rowsHeight).toBe(rows * ROW);
      expect(space.height).toBeGreaterThanOrEqual(MAX_SCROLL_HEIGHT);
      expect(space.height).toBeLessThan(MAX_SCROLL_HEIGHT + ROW);
      expect((space.rowsHeight - space.height) % ROW).toBe(0);
      expect(space.pages).toBeGreaterThan(1);

      // The last page ends exactly where scroll space does, so the last row
      // is reachable and sits at the bottom.
      const last = space.pages - 1;
      expect(offsetOf(space, last)).toBe(space.rowsHeight - space.height);

      let previous = -1;
      for (let page = 0; page < space.pages; page++) {
        const offset = offsetOf(space, page);
        // Whole rows, never going backwards.
        expect(offset % ROW).toBe(0);
        expect(offset).toBeGreaterThanOrEqual(previous);
        previous = offset;
        // The page, drawn one to one from its offset, lies inside scroll
        // space — within the half row the rounding allows.
        const start = page * space.pageHeight - offset;
        const end = Math.min((page + 1) * space.pageHeight, space.rowsHeight) - offset;
        expect(start).toBeGreaterThanOrEqual(-ROW / 2);
        expect(end).toBeLessThanOrEqual(space.height + ROW / 2);
      }
      expect(pageAt(space, 0)).toBe(0);
      expect(pageAt(space, space.rowsHeight)).toBe(last);
      expect(pageAt(space, space.rowsHeight * 2)).toBe(last);
      expect(pageAt(space, -1)).toBe(0);
    });

    test(`${rows} rows: the thumb maps its ends to the first and last page`, () => {
      const space = scrollSpace(rows, ROW);
      const viewport = 500;
      expect(pageAtThumb(space, 0, viewport)).toBe(0);
      expect(pageAtThumb(space, space.height - viewport, viewport)).toBe(space.pages - 1);
      // And is monotonic in between.
      let previous = 0;
      for (let top = 0; top <= space.height - viewport; top += 12_345) {
        const page = pageAtThumb(space, top, viewport);
        expect(page).toBeGreaterThanOrEqual(previous);
        previous = page;
      }
    });
  }

  test("a thumb position and its page agree on where the rows are", () => {
    // A page chosen from the thumb has to draw the scroll position it was
    // chosen for: the rows at `scrollTop + offset` must be within a page and
    // a jump of where the thumb's fraction says they are. (Not necessarily
    // *on* that page — the next wheel event re-pages from the position, and
    // a jump's nudge of the thumb is the cost of that.)
    const space = scrollSpace(1_500_000, ROW);
    const viewport = 500;
    for (let top = 0; top <= space.height - viewport; top += 98_765) {
      const page = pageAtThumb(space, top, viewport);
      const y = top + offsetOf(space, page);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(space.rowsHeight);
      const exact = (top * (space.rowsHeight - viewport)) / (space.height - viewport);
      expect(Math.abs(y - exact)).toBeLessThanOrEqual(space.pageHeight + space.jump);
    }
  });
});
