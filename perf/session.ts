import puppeteer, { type Browser, type CDPSession, type Page } from "puppeteer-core";
import type { Protocol } from "puppeteer-core";
import { MARK } from "../src/lib/perfMarks";

const CHROME_CANDIDATES = ["chromium-browser", "chromium", "google-chrome", "google-chrome-stable"];

export function chromePath(): string {
  const fromEnv = process.env.PERF_CHROME;
  if (fromEnv) return fromEnv;
  for (const name of CHROME_CANDIDATES) {
    const found = Bun.which(name);
    if (found) return found;
  }
  throw new Error(`No Chromium found (tried ${CHROME_CANDIDATES.join(", ")}); set PERF_CHROME`);
}

export const FILE_ID = "7e7e7e7e-0000-4000-8000-000000000001";

export interface Phase {
  name: string;
  wallMs: number;
  profile: Protocol.Profiler.Profile;
}

/**
 * One page of the app under a CDP session: seeds a document, opens the page,
 * and brackets each measured phase with user-timing marks and a CPU profile.
 * The profiler is started before the phase's start mark and stopped after the
 * end mark, so its own interrupts — a few hundred ms of `V8.StackGuard` — fall
 * outside the window the analyser reads.
 */
export class Session {
  readonly phases: Phase[] = [];
  private constructor(
    readonly browser: Browser,
    readonly page: Page,
    readonly cdp: CDPSession,
    readonly url: string
  ) {}

  static async launch(url: string): Promise<Session> {
    const browser = await puppeteer.launch({
      executablePath: chromePath(),
      headless: true,
      args: ["--no-sandbox", "--hide-scrollbars"],
      defaultViewport: { width: 1400, height: 900 }
    });
    const page = await browser.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") console.error(`  [console] ${m.text()}`);
    });
    page.on("pageerror", (e) =>
      console.error(`  [pageerror] ${e instanceof Error ? e.message : e}`)
    );
    const cdp = await page.createCDPSession();
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.enable");
    return new Session(browser, page, cdp, url);
  }

  /** Seeds one document holding `sql` and opens the app on it. `connectionId`
   *  is left for the workspace to heal to the default connection. */
  async open(sql: string): Promise<void> {
    await this.page.evaluateOnNewDocument(
      (id: string, content: string) => {
        localStorage.clear();
        localStorage.setItem(
          `trinocular:workspace:default:file:${id}`,
          JSON.stringify({ id, name: "perf.sql", content, viewFormats: {} })
        );
        localStorage.setItem(
          "trinocular:workspace:default:ui",
          JSON.stringify({ activeFileId: id, order: [id] })
        );
      },
      FILE_ID,
      sql
    );
    await this.page.goto(this.url, { waitUntil: "networkidle0" });
    // Not `waitForSelector`, whose handle would pin the strip (see `runStatement`).
    await this.page.waitForFunction(
      () => !!document.querySelector(".trinocular-statement-toolbar .run"),
      { timeout: 60_000, polling: 100 }
    );
  }

  async phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
    await this.cdp.send("Profiler.start");
    await this.page.evaluate((n) => performance.mark(`perf:${n}:start`), name);
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      const wallMs = performance.now() - t0;
      await this.page.evaluate((n) => performance.mark(`perf:${n}:end`), name);
      const { profile } = await this.cdp.send("Profiler.stop");
      this.phases.push({ name, wallMs, profile });
    }
  }

  /**
   * Clicks the `Run` strip of statement `index` and waits for the result to
   * settle. The click is made in the page rather than through an
   * `ElementHandle`: a handle pins the element on the DevTools side until it
   * is disposed, and the strip's listener closure reaches the result, so an
   * undisposed handle read as the app retaining rows it had dropped.
   */
  async runStatement(index = 0, timeoutMs = 300_000): Promise<void> {
    const before = await this.markCount(MARK.resultSettled);
    const clicked = await this.page.evaluate((i: number) => {
      const button = document.querySelectorAll<HTMLElement>(".trinocular-statement-toolbar .run")[
        i
      ];
      button?.click();
      return !!button;
    }, index);
    if (!clicked) throw new Error(`No Run strip for statement ${index}`);
    await this.waitForMarkCount(MARK.resultSettled, before + 1, timeoutMs);
  }

  async markCount(name: string): Promise<number> {
    return this.page.evaluate((n) => performance.getEntriesByName(n).length, name);
  }

  async waitForMarkCount(name: string, count: number, timeoutMs = 60_000): Promise<void> {
    await this.page.waitForFunction(
      (n: string, c: number) => performance.getEntriesByName(n).length >= c,
      { timeout: timeoutMs, polling: 50 },
      name,
      count
    );
  }

  /** The `detail` of the latest mark of that name, as the app wrote it. */
  async lastMark(name: string): Promise<{ startTime: number; detail: unknown } | null> {
    return this.page.evaluate((n) => {
      const e = performance.getEntriesByName(n).at(-1) as PerformanceMark | undefined;
      return e ? { startTime: e.startTime, detail: e.detail } : null;
    }, name);
  }

  /** Sets the results rail's row cap; `null` switches the cap off. */
  async setLimit(limit: number | null): Promise<void> {
    const pressed = await this.page.$eval(
      ".result .limit .chip",
      (el) => el.getAttribute("aria-pressed") === "true"
    );
    if (limit === null) {
      if (pressed) await this.page.click(".result .limit .chip");
      return;
    }
    if (!pressed) await this.page.click(".result .limit .chip");
    await this.page.$eval(
      ".result .limit .textbox",
      (el, v) => {
        (el as HTMLInputElement).value = v;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      String(limit)
    );
  }

  /** Used JS heap in MB after a forced full collection. */
  async heapMb(): Promise<number> {
    await this.cdp.send("HeapProfiler.collectGarbage");
    await new Promise((r) => setTimeout(r, 200));
    const m = await this.metrics();
    return Math.round(m.JSHeapUsedSize / 1e5) / 10;
  }

  async metrics(): Promise<Record<string, number>> {
    const { metrics } = await this.cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  }

  /** Clicks the tree row whose label reads `label` and waits for the fetch it starts. */
  async clickTreeNode(label: string, timeoutMs = 60_000): Promise<void> {
    const before = await this.page.$$eval(".tree button.label", (els) => els.length);
    const clicked = await this.page.evaluate((text: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(".tree button.label")].find(
        (b) => b.querySelector(".node-label")?.textContent === text
      );
      if (!button) return false;
      button.click();
      return true;
    }, label);
    if (!clicked) throw new Error(`No tree node labelled ${label}`);
    await this.page.waitForFunction(
      (n: number) =>
        !document.querySelector(".tree .spin") &&
        document.querySelectorAll(".tree button.label").length > n,
      { timeout: timeoutMs, polling: 50 },
      before
    );
  }

  /** Puts the caret in monaco. Not a click on the text, which on a long file
   *  lands on a statement's Run strip as often as not. */
  async focusEditor(): Promise<void> {
    await this.page.focus(".monaco-editor .native-edit-context, .monaco-editor textarea.inputarea");
  }

  /** Whether the page came from `vite dev` rather than the build. */
  async isDev(): Promise<boolean> {
    return this.page.evaluate(() => !!document.querySelector('script[src*="/@vite/client"]'));
  }

  async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
