/**
 * Trino reports where a statement went wrong relative to the statement it was
 * sent, in the message as much as in `errorLocation`: `line 1:22: Schema must
 * be specified…` is the first line of the *statement*, which in a file of
 * several is not line 1 at all. The editor marker is already translated; this
 * does the same for the message, so that the text and the gutter agree.
 */

const LOCATION_PREFIX = /^line (\d+):(\d+): /;

/**
 * `message` with a leading `line N:M:` moved from statement lines to file
 * lines, given the file line the statement starts on. Anything else is
 * returned as written, and so is a message from a statement at the top of the
 * file, whose lines already agree.
 */
export function fileLineMessage(message: string, startLine: number): string {
  if (startLine <= 1) return message;
  return message.replace(
    LOCATION_PREFIX,
    (_, line: string, column: string) => `line ${Number(line) + startLine - 1}:${column}: `
  );
}
