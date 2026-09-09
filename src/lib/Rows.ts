import type { QueryData } from "$lib/trino";

/**
 * The rows of a result, kept as the pages Trino sent rather than flattened into
 * one array.
 *
 * Flattening was quadratic. `$state.raw` notices a change by reference, so each
 * arriving page had to produce a *new* array — and `concat` copies every row
 * accumulated so far to do that. Page 500 of a query copied 500,000 rows to
 * append 1,000. Measured over a million rows across a thousand pages that is
 * ~2.4s of pure copying on the main thread, while the table it is feeding is
 * trying to render; at 4,000 smaller pages it is ~9s, so the cost got worse the
 * less control you had over it.
 *
 * Appending a page here copies the *outer* array — one pointer per page, not
 * one per row — which is the same ~2.4s reduced to ~1ms. The pages themselves
 * are shared by reference and never copied, which also halves peak memory: the
 * old code held both the previous flat array and its replacement at every
 * append.
 *
 * The point of the reassignment is that it keeps the file's existing pattern
 * honest. An alternative fix was to push into one mutable array and publish a
 * separate `rowCount` rune for consumers to depend on, since mutation alone
 * cannot wake `$state.raw`. That works and is fewer lines, but it splits "the
 * rows" from "the fact that the rows changed" and leaves every reader obliged
 * to know about both. Here `append` returns a new `Rows`, reference identity
 * changes, and the reactivity means what it looks like it means.
 *
 * **`Rows` must stay immutable.** `append` returning a new instance is not
 * ceremony — mutating in place would leave the reference unchanged and the
 * table would simply stop updating mid-query, with nothing to see in the code
 * that reads it.
 */
export class Rows {
  /** Absolute index of each page's first row; `starts[i] + pages[i].length` is the next. */
  readonly #starts: readonly number[];
  readonly #pages: readonly (readonly QueryData[])[];
  readonly length: number;

  static readonly empty = new Rows([], [], 0);

  private constructor(
    pages: readonly (readonly QueryData[])[],
    starts: readonly number[],
    length: number
  ) {
    this.#pages = pages;
    this.#starts = starts;
    this.length = length;
  }

  /** A new `Rows` with `page` on the end. An empty page changes nothing, and
   *  returning `this` for one keeps a heartbeat chunk from waking the table. */
  append(page: readonly QueryData[]): Rows {
    if (page.length === 0) return this;
    return new Rows(
      [...this.#pages, page],
      [...this.#starts, this.length],
      this.length + page.length
    );
  }

  /** The page holding absolute row `index`. Binary search over the starts: at
   *  four thousand pages that is twelve comparisons, against the linear walk
   *  the obvious version would do on every cell of every scroll frame. */
  #pageOf(index: number): number {
    let lo = 0;
    let hi = this.#starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.#starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  at(index: number): QueryData | undefined {
    if (index < 0) index += this.length;
    if (index < 0 || index >= this.length) return undefined;
    const page = this.#pageOf(index);
    return this.#pages[page][index - this.#starts[page]];
  }

  /**
   * `Array.prototype.slice`, including the negative and out-of-range handling,
   * because this stands in for an array at call sites that were written against
   * one — the table's visible window and the selection's rectangle.
   */
  slice(start = 0, end = this.length): QueryData[] {
    const from = clamp(start, this.length);
    const to = clamp(end, this.length);
    const out: QueryData[] = [];
    if (from >= to || this.length === 0) return out;

    let page = this.#pageOf(from);
    let offset = from - this.#starts[page];
    for (let i = from; i < to; i++) {
      const rows = this.#pages[page];
      if (offset >= rows.length) {
        page++;
        offset = 0;
      }
      out.push(this.#pages[page][offset++]);
    }
    return out;
  }

  *[Symbol.iterator](): IterableIterator<QueryData> {
    for (const page of this.#pages) yield* page;
  }
}

/** An index the way `Array.prototype.slice` reads one: negative counts back
 *  from the end, and anything beyond either edge is pinned to it. */
function clamp(index: number, length: number): number {
  if (index < 0) return Math.max(length + index, 0);
  return Math.min(index, length);
}
