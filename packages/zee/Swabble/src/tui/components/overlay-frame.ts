import { type Component, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";

type OverlayChild = Component & {
  handleInput?: (data: string) => void;
};

export class OverlayFrame implements Component {
  private child: OverlayChild;
  private pad: number;

  constructor(child: OverlayChild, pad = 1) {
    this.child = child;
    this.pad = pad;
  }

  render(width: number): string[] {
    const pad = this.pad;
    const innerWidth = Math.max(1, width - pad * 2);
    const raw = this.child.render(innerWidth);
    const lines = raw.length > 0 ? raw : [""];
    const contentWidth = Math.min(
      innerWidth,
      Math.max(1, lines.reduce((acc, line) => Math.max(acc, visibleWidth(line)), 0)),
    );
    const left = " ".repeat(pad);
    const right = " ".repeat(pad);

    return lines.map((line) => {
      const lineWidth = visibleWidth(line);
      const fill = Math.max(0, contentWidth - lineWidth);
      const padded = `${left}${line}${" ".repeat(fill)}${right}`;
      return theme.toolPendingBg(padded);
    });
  }

  invalidate(): void {
    this.child.invalidate();
  }

  handleInput(data: string): void {
    this.child.handleInput?.(data);
  }
}
