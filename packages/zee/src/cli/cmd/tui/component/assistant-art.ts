export const ASSISTANT_ART: Record<string, string[]> = {
  zee: [
    "███████╗███████╗███████╗",
    "╚══███╔╝██╔════╝██╔════╝",
    "  ███╔╝ █████╗  █████╗  ",
    " ███╔╝  ██╔══╝  ██╔══╝  ",
    "███████╗███████╗███████╗",
    "╚══════╝╚══════╝╚══════╝",
  ],
}

export function resolveAssistantArt(): string[] {
  return ASSISTANT_ART.zee
}
