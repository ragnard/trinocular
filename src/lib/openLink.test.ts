import { describe, expect, test } from "bun:test";
import { MAX_NAME_LENGTH, MAX_SQL_LENGTH, linkedQuery, withoutLinkParams } from "./openLink";

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
