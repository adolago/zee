import { Container, truncateToWidth as piTruncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export interface StatusBarTheme {
  outerBorder: (text: string) => string;
  innerBorder: (text: string) => string;
  reminderText: (text: string) => string;
  statusText: (text: string) => string;
  accentText: (text: string) => string;
  titleText: (text: string) => string;
  dimText: (text: string) => string;
}

export interface StatusBarState {
  personaName: string;
  reminderText: string;
  spinnerFrame?: string;
  statusLabel?: string;
  contextPercent?: number | null;
  tokenCount?: string | null;
}

// Box drawing characters for a delicate, refined look
const BOX = {
  // Outer box - rounded corners
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  // Inner box - lighter single line
  innerTopLeft: "┌",
  innerTopRight: "┐",
  innerBottomLeft: "└",
  innerBottomRight: "┘",
  innerHorizontal: "─",
  innerVertical: "│",
  // Decorative
  dot: "·",
  bullet: "▫",
};

/**
 * StatusBar component with a beautiful "box over box" design.
 * Features:
 * - Outer rounded box containing everything
 * - Inner box for reminder/tip content
 * - Delicate status line with persona name, context %, tokens
 */
export class StatusBar extends Container {
  private theme: StatusBarTheme;
  private state: StatusBarState;
  private segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

  constructor(theme: StatusBarTheme, initialState?: Partial<StatusBarState>) {
    super();
    this.theme = theme;
    this.state = {
      personaName: initialState?.personaName ?? "zee",
      reminderText: initialState?.reminderText ?? "",
      spinnerFrame: initialState?.spinnerFrame,
      statusLabel: initialState?.statusLabel,
      contextPercent: initialState?.contextPercent,
      tokenCount: initialState?.tokenCount,
    };
  }

  setState(updates: Partial<StatusBarState>): void {
    Object.assign(this.state, updates);
  }

  setPersonaName(name: string): void {
    this.state.personaName = name;
  }

  setReminderText(text: string): void {
    this.state.reminderText = text;
  }

  setSpinner(frame: string | undefined): void {
    this.state.spinnerFrame = frame;
  }

  setStatus(label: string | undefined): void {
    this.state.statusLabel = label;
  }

  setContext(percent: number | null, tokens: string | null): void {
    this.state.contextPercent = percent;
    this.state.tokenCount = tokens;
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const innerWidth = Math.max(10, width - 4); // Account for outer box borders + padding

    // === Outer box top ===
    const topBorder = `${BOX.topLeft}${BOX.horizontal.repeat(width - 2)}${BOX.topRight}`;
    lines.push(this.theme.outerBorder(topBorder));

    // === Inner reminder box (if we have reminder text) ===
    if (this.state.reminderText) {
      const reminderLines = this.renderInnerBox(innerWidth, this.state.reminderText);
      for (const line of reminderLines) {
        lines.push(this.wrapInOuterBox(line, width));
      }

      // Separator line
      const separator = `${BOX.dot}${BOX.horizontal.repeat(Math.max(0, innerWidth - 2))}${BOX.dot}`;
      lines.push(this.wrapInOuterBox(this.theme.dimText(separator), width));
    }

    // === Status line ===
    const statusLine = this.renderStatusLine(innerWidth);
    lines.push(this.wrapInOuterBox(statusLine, width));

    // Outer padding
    lines.push(this.wrapInOuterBox("", width));

    // === Outer box bottom ===
    const bottomBorder = `${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}`;
    lines.push(this.theme.outerBorder(bottomBorder));

    return lines;
  }

  private renderInnerBox(width: number, content: string): string[] {
    const innerContentWidth = Math.max(4, width - 4); // Account for inner box borders + padding
    const truncatedContent = this.truncateToWidth(content, innerContentWidth);
    const contentPadding = innerContentWidth - visibleWidth(truncatedContent);

    const lines: string[] = [];

    // Inner top
    const innerTop = `${BOX.innerTopLeft}${BOX.innerHorizontal.repeat(width - 2)}${BOX.innerTopRight}`;
    lines.push(this.theme.innerBorder(innerTop));

    // Inner content
    const innerContent = `${this.theme.innerBorder(BOX.innerVertical)} ${this.theme.reminderText(truncatedContent)}${" ".repeat(contentPadding)} ${this.theme.innerBorder(BOX.innerVertical)}`;
    lines.push(innerContent);

    // Inner padding
    const emptyInnerLine = `${this.theme.innerBorder(BOX.innerVertical)}${" ".repeat(width - 2)}${this.theme.innerBorder(BOX.innerVertical)}`;
    lines.push(emptyInnerLine);

    // Inner bottom
    const innerBottom = `${BOX.innerBottomLeft}${BOX.innerHorizontal.repeat(width - 2)}${BOX.innerBottomRight}`;
    lines.push(this.theme.innerBorder(innerBottom));

    return lines;
  }

  private renderStatusLine(width: number): string {
    const parts: string[] = [];

    // Spinner or bullet
    if (this.state.spinnerFrame) {
      parts.push(this.theme.accentText(this.state.spinnerFrame));
    } else {
      parts.push(this.theme.dimText(BOX.bullet));
    }

    // Status label (e.g., "Thinking...")
    if (this.state.statusLabel) {
      parts.push(this.theme.statusText(this.state.statusLabel));
    }

    if (this.state.contextPercent != null) {
      parts.push(this.theme.dimText(`${this.state.contextPercent}%`));
    }

    const leftSide = parts.join(" ");

    // Right side: persona | context % | tokens
    const rightParts: string[] = [];
    rightParts.push(this.theme.titleText(this.state.personaName));

    if (this.state.tokenCount) {
      rightParts.push(this.theme.dimText(this.state.tokenCount));
    }

    const rightSide = rightParts.join(` ${this.theme.dimText(BOX.dot)} `);

    // Calculate spacing
    const leftWidth = visibleWidth(leftSide);
    const rightWidth = visibleWidth(rightSide);
    const spacer = Math.max(1, width - leftWidth - rightWidth);

    return `${leftSide}${" ".repeat(spacer)}${rightSide}`;
  }

  private wrapInOuterBox(content: string, totalWidth: number): string {
    const innerSpace = Math.max(1, totalWidth - 4); // 2 for borders, 2 for padding
    const padded = piTruncateToWidth(content, innerSpace, "", true);
    return `${this.theme.outerBorder(BOX.vertical)} ${padded} ${this.theme.outerBorder(BOX.vertical)}`;
  }

  private truncateToWidth(text: string, maxWidth: number): string {
    if (visibleWidth(text) <= maxWidth) return text;

    const ellipsis = "…";
    const targetWidth = Math.max(0, maxWidth - visibleWidth(ellipsis));
    let result = "";
    let currentWidth = 0;

    for (const { segment } of this.segmenter.segment(text)) {
      const segmentWidth = visibleWidth(segment);
      if (currentWidth + segmentWidth > targetWidth) break;
      result += segment;
      currentWidth += segmentWidth;
    }

    return result + ellipsis;
  }

  invalidate(): void {
    // No caching, always re-render
  }
}
