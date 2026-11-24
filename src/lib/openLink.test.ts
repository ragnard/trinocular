import { describe, expect, test } from "bun:test";
import {
  MAX_LINK_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SQL_LENGTH,
  linkedQuery,
  queryLink,
  withoutLinkParams
} from "./openLink";

const params = (query: string) => new URLSearchParams(query);

describe("linkedQuery", () => {
  test("is nothing when the link carries no sql", () => {
    expect(linkedQuery(params(""))).toBeNull();
    expect(linkedQuery(params("name=report.sql"))).toBeNull();
  });

  test("takes the sql as it was written", () => {
    const linked = linkedQuery(params("sql=" + encodeURIComponent("SELECT 1;\nSELECT 2;")));
    expect(linked).toEqual({ ok: true, sql: "SELECT 1;\nSELECT 2;", name: null });
  });

  test("takes a name beside it", () => {
    const linked = linkedQuery(params("sql=SELECT+1&name=orders.sql"));
    expect(linked).toEqual({ ok: true, sql: "SELECT 1", name: "orders.sql" });
  });

  test("an empty query is not a request for an empty document", () => {
    expect(linkedQuery(params("sql="))).toBeNull();
    expect(linkedQuery(params("sql=" + encodeURIComponent("  \n ")))).toBeNull();
  });

  test("refuses SQL past the cap rather than truncating it", () => {
    const linked = linkedQuery(params("sql=" + "x".repeat(MAX_SQL_LENGTH + 1)));
    expect(linked?.ok).toBe(false);
  });

  test("a name is one bounded line", () => {
    const linked = linkedQuery(params("sql=SELECT+1&name=" + encodeURIComponent("a\nb\tc")));
    expect(linked).toMatchObject({ name: "a b c" });

    const long = linkedQuery(params("sql=SELECT+1&name=" + "n".repeat(200)));
    expect((long as { name: string }).name.length).toBe(MAX_NAME_LENGTH);
  });

  test("a name of nothing but whitespace is no name", () => {
    expect(linkedQuery(params("sql=SELECT+1&name=%20%20"))).toMatchObject({ name: null });
  });
});

describe("queryLink", () => {
  const base = new URL("https://trinocular.example/");
  const href = (sql: string) => {
    const link = queryLink(sql, base);
    if (!link.ok) throw new Error(link.reason);
    return link.url;
  };

  test("is read back as the sql it was made from", () => {
    const sql =
      "-- 100% & more\nSELECT 'a+b=c#d?', \"x y\", U&'\\00e5', 'å🦈'\nFROM t\nWHERE id <> 3 -- tail";
    expect(linkedQuery(new URL(href(sql)).searchParams)).toEqual({ ok: true, sql, name: null });
  });

  test("trims what surrounds the statement", () => {
    expect(href("\n\nSELECT 1\n")).toBe("https://trinocular.example/?sql=SELECT+1");
  });

  test("carries nothing from the page it was made on but where the app is", () => {
    const link = queryLink("SELECT 1", new URL("https://t.example/sub/?sql=old&name=a.sql#top"));
    expect(link).toEqual({ ok: true, url: "https://t.example/sub/?sql=SELECT+1" });
  });

  test("has nothing to link to in whitespace", () => {
    expect(queryLink(" \n ", base).ok).toBe(false);
  });

  test("refuses rather than truncates, by the length the login redirect carries", () => {
    const longest = MAX_LINK_LENGTH - encodeURIComponent("/?sql=").length;
    expect(queryLink("x".repeat(longest), base).ok).toBe(true);
    expect(queryLink("x".repeat(longest + 1), base).ok).toBe(false);
    // A newline is three characters in the link and five in the redirect.
    expect(queryLink("x" + "\n".repeat(longest / 4) + "x", base).ok).toBe(false);
  });

  test("a link this app writes is one it will open", () => {
    expect(MAX_LINK_LENGTH).toBeLessThanOrEqual(MAX_SQL_LENGTH);
  });
});

describe("withoutLinkParams", () => {
  test("takes the link's parameters off and leaves the rest", () => {
    const url = new URL("https://trinocular.example/?sql=SELECT+1&name=a.sql&keep=yes");
    expect(withoutLinkParams(url).toString()).toBe("https://trinocular.example/?keep=yes");
  });

  test("leaves a URL that carried none of them alone", () => {
    const url = new URL("https://trinocular.example/");
    expect(withoutLinkParams(url).toString()).toBe("https://trinocular.example/");
  });
});
