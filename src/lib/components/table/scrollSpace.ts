/**
 * The arithmetic behind the table's virtual scroll, for when the rows outgrow
 * what a browser will let an element be.
 *
 * Browsers clamp an element's height — Chrome at 33,554,432px, Firefox at
 * about 17,895,697px — so a scroll area of `totalRows × rowHeight` stops
 * short of the rows past ~1.1M in Chrome and ~600k in Firefox, and near the
 * limit draws the rows it does reach misaligned as the layout units overflow.
 * So there are two spaces. *Row space* is the rows laid end to end,
 * `rowsHeight` tall. *Scroll space* is what the container actually scrolls:
 * the same thing while row space fits under `MAX_SCROLL_HEIGHT`, and once it
 * does not, row space cut into `SCROLL_PAGES` pages that are each drawn one
 * to one, with every page starting `jump` px earlier in scroll space than in
 * row space so that together they fill the capped area. The difference for
 * the page on screen is its *offset*, always a whole number of rows so that a
 * row starts on a row boundary in both spaces, and `rowSpace = scrollSpace +
 * offset` is the whole conversion. Scrolling within a page — the wheel, the
 * keys — therefore moves rows one for one; crossing a page boundary changes
 * the offset and nudges the thumb by a jump; and a thumb drag, which can only
 * mean a fraction of the whole, maps its position proportionally and lands on
 * the page there. The arrangement is SlickGrid's. The cap is well under
 * either browser's limit, which also keeps the layout units out of the range
 * where they overflow.
 */

export const MAX_SCROLL_HEIGHT = 10_000_000;
export const SCROLL_PAGES = 100;

export interface ScrollSpace {
  rowHeight: number;
  /** Row space: every row, end to end. */
  rowsHeight: number;
  /** Scroll space: what the container scrolls. `rowsHeight` under the cap;
   *  past it the cap, plus whatever makes `rowsHeight - height` whole rows,
   *  so the last page's offset is exact and the last row ends at `height`. */
  height: number;
  /** Scroll space per page, and row space too — pages are drawn one to one. */
  pageHeight: number;
  pages: number;
  /** How much earlier in scroll space each page starts than the one before
   *  would place it. Zero under the cap. */
  jump: number;
}

export function scrollSpace(totalRows: number, rowHeight: number, max = MAX_SCROLL_HEIGHT) {
  const rowsHeight = totalRows * rowHeight;
  if (rowsHeight <= max) {
    return { rowHeight, rowsHeight, height: rowsHeight, pageHeight: rowsHeight, pages: 1, jump: 0 };
  }
  const height = max + ((rowsHeight - max) % rowHeight);
  const pageHeight = height / SCROLL_PAGES;
  const pages = Math.floor(rowsHeight / pageHeight);
  const jump = (rowsHeight - height) / (pages - 1);
  return { rowHeight, rowsHeight, height, pageHeight, pages, jump };
}

/** The page holding `y` in row space. */
export function pageAt(space: ScrollSpace, y: number) {
  if (space.pages === 1) return 0;
  return Math.max(0, Math.min(space.pages - 1, Math.floor(y / space.pageHeight)));
}

/** Row space minus scroll space while `page` is the one on screen: `page ×
 *  jump`, rounded to whole rows. Rounded rather than floored so that the
 *  last page's offset is exactly `rowsHeight - height` whatever floating
 *  point did to the product. */
export function offsetOf(space: ScrollSpace, page: number) {
  return Math.round((page * space.jump) / space.rowHeight) * space.rowHeight;
}

/** The page a thumb drag to `scrollTop` means: the same fraction of row
 *  space as it is of scroll space, with `viewport` (the container's inner
 *  height) taken off both so that the end of one is the end of the other. */
export function pageAtThumb(space: ScrollSpace, scrollTop: number, viewport: number) {
  if (space.pages === 1) return 0;
  const ratio = (space.rowsHeight - viewport) / (space.height - viewport);
  return pageAt(space, scrollTop * ratio);
}
