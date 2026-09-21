import { describe, expect, test } from "bun:test";
import { sizesOf, withSizes } from "./layout";

const layout = [
  { size: 19, min: "180px" as const, max: "40%" as const },
  { size: 54, min: "30%" as const },
  { size: 27, min: "12%" as const }
];

describe("withSizes", () => {
  test("takes stored sizes in place of the declared ones, keeping the bounds", () => {
    expect(withSizes(layout, [20, 50, 30])).toEqual([
      { size: 20, min: "180px", max: "40%" },
      { size: 50, min: "30%" },
      { size: 30, min: "12%" }
    ]);
  });

  test("round-trips what sizesOf hands out", () => {
    expect(withSizes(layout, sizesOf(layout))).toEqual(layout);
  });

  test("takes the sizes as weights, judged against the bounds as shares of their total", () => {
    expect(sizesOf(withSizes(layout, [2, 5, 3]))).toEqual([2, 5, 3]);
    expect(withSizes(layout, [4.5, 4, 1.5])).toBe(layout); // 45% past the 40% max
  });

  test("keeps the declared layout when the stored one is not a list of the panes", () => {
    for (const stored of [undefined, null, "x", {}, [], [20, 80], [20, 50, 30, 0]]) {
      expect(withSizes(layout, stored)).toBe(layout);
    }
  });

  test("keeps the declared layout when a size is not a usable number", () => {
    for (const stored of [
      [20, "50", 30],
      [20, NaN, 30],
      [20, Infinity, 30],
      [-1, 51, 50],
      [0, 0, 0]
    ]) {
      expect(withSizes(layout, stored)).toBe(layout);
    }
  });

  test("keeps the declared layout when a pane is outside a percentage bound", () => {
    expect(withSizes(layout, [45, 40, 15])).toBe(layout); // first past its 40% max
    expect(withSizes(layout, [30, 25, 45])).toBe(layout); // second under its 30% min
    expect(withSizes(layout, [30, 60, 10])).toBe(layout); // third under its 12% min
    expect(withSizes(layout, [40, 30, 30])).not.toBe(layout); // exactly on the bounds
  });

  test("does not judge a pixel bound", () => {
    // 1% of any window is under 180px; the bound is CSS's until there is a container.
    expect(sizesOf(withSizes(layout, [1, 87, 12]))).toEqual([1, 87, 12]);
  });
});
