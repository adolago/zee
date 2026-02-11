/**
 * Output utility for standardized stream handling
 *
 * Rules:
 * - User-facing messages -> stderr (for CLI UX, doesn't pollute piped stdout)
 * - Structured data (JSON) -> stdout (for piping to other commands)
 * - Error messages -> stderr
 */
export const Output = {
  // User messages -> stderr
  log: (msg: string) => Bun.stderr.write(msg + "\n"),
  error: (msg: string) => Bun.stderr.write(msg + "\n"),

  // Structured data -> stdout
  data: (obj: unknown) => console.log(JSON.stringify(obj)),

  // Direct access
  stdout: process.stdout,
  stderr: process.stderr,
}
