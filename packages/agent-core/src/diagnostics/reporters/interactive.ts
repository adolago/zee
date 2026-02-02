/**
 * @file Interactive Reporter
 * @description TTY-friendly colored output for health check results
 * 
 * NO_COLOR Support:
 * This reporter respects the NO_COLOR environment variable (https://no-color.org/).
 * When NO_COLOR is set:
 * - All ANSI color codes are disabled
 * - ASCII symbols are used instead of Unicode
 * - Plain text formatting is used
 * Use FORCE_COLOR to explicitly enable colors.
 */

import type { CheckReport, CheckResult, CheckCategory } from "../types";
import { Style, Symbols, shouldUseColors, shouldUseUnicode } from "../../cli/style";

/**
 * Determine if colors should be used based on environment variables.
 * Follows the no-color.org standard.
 */
function checkColorSupport(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return process.stdout.isTTY ?? false;
}

// Color definitions - used only when colors are enabled
const COLORS_ENABLED: Record<string, string> = {
  reset: Style.reset,
  bold: Style.bold,
  dim: Style.dim,
  green: Style.success,
  yellow: Style.warning,
  red: Style.error,
  cyan: Style.ansi.cyan,
  gray: Style.muted,
};

// Empty color definitions for no-color mode
const COLORS_DISABLED = {
  reset: "",
  bold: "",
  dim: "",
  green: "",
  yellow: "",
  red: "",
  cyan: "",
  gray: "",
};

// Unicode icons - used when Unicode is enabled
const ICONS_UNICODE = {
  pass: `${Style.success}${Symbols.check}${Style.reset}`,
  warn: `${Style.warning}${Symbols.warning}${Style.reset}`,
  fail: `${Style.error}${Symbols.cross}${Style.reset}`,
  skip: `${Style.muted}${Symbols.bullet}${Style.reset}`,
};

// ASCII icons - used when Unicode is disabled (NO_COLOR mode)
const ICONS_ASCII = {
  pass: "[OK]",
  warn: "[!]",
  fail: "[X]",
  skip: "[-]",
};

const CATEGORY_NAMES: Record<CheckCategory, string> = {
  runtime: "Core Runtime",
  config: "Configuration",
  providers: "Providers",
  integrity: "Integrity",
};

export class InteractiveReporter {
  private verbose: boolean;
  private useColors: boolean;
  private useUnicode: boolean;
  private colors: typeof COLORS_ENABLED;
  private icons: typeof ICONS_UNICODE;

  constructor(options: { verbose?: boolean; colors?: boolean } = {}) {
    this.verbose = options.verbose || false;
    this.useColors = options.colors ?? checkColorSupport();
    this.useUnicode = shouldUseUnicode();
    
    // Select appropriate color/icon sets based on configuration
    this.colors = this.useColors ? COLORS_ENABLED : COLORS_DISABLED;
    this.icons = this.useUnicode ? ICONS_UNICODE : ICONS_ASCII;
  }

  format(report: CheckReport): string {
    const lines: string[] = [];
    const c = this.colors;
    
    // Get plain-text versions of icons when colors are disabled
    const icons = this.useColors ? this.icons : {
      pass: "[OK]",
      warn: "[!]",
      fail: "[X]",
      skip: "[-]",
    };

    lines.push("");
    lines.push(`${c.bold}Agent-Core Health Check${c.reset}`);
    
    // Use appropriate line style based on Unicode support
    const lineChar = this.useUnicode ? Symbols.hDoubleLine : "=";
    lines.push(`${c.gray}${lineChar.repeat(50)}${c.reset}`);
    lines.push("");

    for (const cat of ["runtime", "config", "providers", "integrity"] as CheckCategory[]) {
      const summary = report.categories[cat];
      if (summary.total === 0) continue;

      const icon = summary.status === "ok" ? icons.pass : summary.status === "warning" ? icons.warn : icons.fail;
      lines.push(`${icon} ${c.bold}${CATEGORY_NAMES[cat]}${c.reset}`);

      for (const check of summary.checks) {
        const checkIcon = icons[check.status];
        lines.push(`   ${checkIcon} ${check.name}: ${check.message}`);

        if (this.verbose && check.details) {
          for (const detail of check.details.split("\n")) {
            lines.push(`      ${c.gray}${detail}${c.reset}`);
          }
        }
      }
      lines.push("");
    }

    if (report.fixes.length > 0) {
      const gearIcon = this.useUnicode ? Symbols.gear : "[FIX]";
      lines.push(`${c.cyan}${gearIcon} Auto-fixed${c.reset}`);
      for (const fix of report.fixes) {
        const icon = fix.success ? icons.pass : icons.fail;
        lines.push(`   ${icon} ${fix.message}`);
      }
      lines.push("");
    }

    const { passed, warnings, failed, skipped } = report.summary;
    
    // Use appropriate line style based on Unicode support
    const singleLineChar = this.useUnicode ? Symbols.hLine : "-";
    lines.push(`${c.gray}${singleLineChar.repeat(50)}${c.reset}`);

    const parts = [];
    if (passed > 0) parts.push(`${c.green}${passed} passed${c.reset}`);
    if (warnings > 0) parts.push(`${c.yellow}${warnings} warnings${c.reset}`);
    if (failed > 0) parts.push(`${c.red}${failed} failed${c.reset}`);
    if (skipped > 0) parts.push(`${c.gray}${skipped} skipped${c.reset}`);

    lines.push(`Summary: ${parts.join(", ")}`);
    lines.push(`${c.gray}Completed in ${report.durationMs}ms${c.reset}`);
    lines.push("");

    return lines.join("\n");
  }
}
