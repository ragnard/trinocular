import { describe, expect, test } from "bun:test";
import { logPath } from "./logPath";

describe("logPath", () => {
  test("keeps the origin and the path", () => {
    expect(logPath("https://trinocular.example/api/workspace")).toBe(
      "https://trinocular.example/api/workspace"
    );
  });

  test("drops the query string", () => {
    expect(logPath("https://trinocular.example/?sql=SELECT%201&name=a.sql")).toBe(
      "https://trinocular.example/"
    );
  });

  test("drops an authorization code", () => {
    expect(logPath("https://trinocular.example/auth/callback?code=abc&state=xyz")).toBe(
      "https://trinocular.example/auth/callback"
    );
  });

  test("drops the fragment too", () => {
    expect(logPath("https://trinocular.example/page#secret")).toBe(
      "https://trinocular.example/page"
    );
  });

  test("a redirect's relative location keeps its path alone", () => {
    expect(logPath("/auth/login?returnTo=%2F%3Fsql%3DSELECT%25201")).toBe("/auth/login");
  });

  // Resolved against the relative base, so it comes back path-shaped rather
  // than as itself: whatever it is, it is not a query string.
  test("something that is not a URL still leaks no parameters", () => {
    expect(logPath("not a url?sql=SELECT%201")).toBe("/not%20a%20url");
  });
});
