export function normalizeInboundTextNewlines(input: string): string {
  // Normalize actual newline characters while preserving literal "\n" sequences.
  // Literal backslash-n values are common in Windows paths and user text.
  return input.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
