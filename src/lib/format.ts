/**
 * Number formatting for the query progress surfaces. Counts and byte sizes in
 * Trino stats span many orders of magnitude within one query, so exact digits
 * are kept while they are still readable and compacted after that.
 */

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1
});

const exact = new Intl.NumberFormat();

/** Splits, rows: exact up to five digits, then 12.9K / 4.2M / 1.3B. */
export function formatCount(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return n < 100000 ? exact.format(n) : compact.format(n);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** 1024-based, matching the units Trino's own UI reports. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "–";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** Wall/CPU times: 412ms, 12.4s, 3m 12s, 1h 04m. */
export function formatDuration(millis: number | undefined): string {
  if (millis == null || !Number.isFinite(millis)) return "–";
  if (millis < 1000) return `${Math.round(millis)}ms`;
  const seconds = millis / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
