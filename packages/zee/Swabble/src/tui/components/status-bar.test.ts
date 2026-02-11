import { describe, it, expect } from "vitest";
import { StatusBar, type StatusBarTheme } from "./status-bar.js";

const mockTheme: StatusBarTheme = {
  outerBorder: (t) => t,
  innerBorder: (t) => t,
  reminderText: (t) => t,
  statusText: (t) => t,
  accentText: (t) => t,
  dimText: (t) => t,
};

describe("StatusBar", () => {
  it("renders with default state", () => {
    const bar = new StatusBar(mockTheme);
    const lines = bar.render(60);
    expect(lines.length).toBeGreaterThan(0);
    // Should have top and bottom borders
    expect(lines[0]).toContain("╭");
    expect(lines[lines.length - 1]).toContain("╰");
  });

  it("renders outer box with rounded corners", () => {
    const bar = new StatusBar(mockTheme);
    const lines = bar.render(40);
    expect(lines[0]).toMatch(/^╭.*╮$/);
    expect(lines[lines.length - 1]).toMatch(/^╰.*╯$/);
  });

  it("renders inner box when reminder text is provided", () => {
    const bar = new StatusBar(mockTheme, {
      reminderText: "Test reminder",
    });
    const lines = bar.render(60);
    const joinedLines = lines.join("\n");
    // Should contain inner box characters
    expect(joinedLines).toContain("┌");
    expect(joinedLines).toContain("└");
    expect(joinedLines).toContain("Test reminder");
  });

  it("displays persona name in status line", () => {
    const bar = new StatusBar(mockTheme, {
      personaName: "zee",
    });
    const lines = bar.render(60);
    const joinedLines = lines.join("\n");
    expect(joinedLines).toContain("zee");
  });

  it("updates persona name via setPersonaName", () => {
    const bar = new StatusBar(mockTheme, { personaName: "initial" });
    bar.setPersonaName("updated");
    const lines = bar.render(60);
    const joinedLines = lines.join("\n");
    expect(joinedLines).toContain("updated");
    expect(joinedLines).not.toContain("initial");
  });

  it("shows context percentage when set", () => {
    const bar = new StatusBar(mockTheme);
    bar.setContext(25, "45k tokens");
    const lines = bar.render(60);
    const joinedLines = lines.join("\n");
    expect(joinedLines).toContain("25%");
    expect(joinedLines).toContain("45k tokens");
  });

  it("updates state via setState", () => {
    const bar = new StatusBar(mockTheme);
    bar.setState({
      personaName: "nova",
      statusLabel: "thinking",
      contextPercent: 50,
      tokenCount: "100k",
    });
    const lines = bar.render(80);
    const joinedLines = lines.join("\n");
    expect(joinedLines).toContain("nova");
    expect(joinedLines).toContain("thinking");
    expect(joinedLines).toContain("50%");
    expect(joinedLines).toContain("100k");
  });

  it("shows status label when provided", () => {
    const bar = new StatusBar(mockTheme);
    bar.setStatus("streaming");
    const lines = bar.render(60);
    const joinedLines = lines.join("\n");
    expect(joinedLines).toContain("streaming");
  });

  it("handles narrow width gracefully", () => {
    const bar = new StatusBar(mockTheme, {
      personaName: "zee",
      reminderText: "A very long reminder text that should be truncated",
    });
    // Should not throw with narrow width
    expect(() => bar.render(20)).not.toThrow();
  });
});
