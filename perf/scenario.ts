import type { Session } from "./session";
import type { Trace } from "./trace";

export interface Outcome {
  /** What the scenario is about, in its own unit: ms per page, per keystroke, MB. */
  metrics: Record<string, number | string>;
  /** Structural assertions — counts and rules, never absolute milliseconds. */
  checks?: Record<string, boolean>;
}

export interface Scenario {
  name: string;
  description: string;
  /**
   * Drives the session, then hands back the reading of the trace: the trace
   * is only available once tracing has stopped, after the drive is over.
   */
  run(s: Session): Promise<(trace: Trace) => Outcome>;
}
