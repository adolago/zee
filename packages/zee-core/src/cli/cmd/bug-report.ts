/**
 * @file CLI Bug Report Command
 * @description CLI entry point for crash report generation
 */

import type { Argv } from "yargs";
import * as readline from "readline";
import { ReportGenerator } from "../../crash-report/report-generator";
import { cmd } from "./cmd";

const ANONYMIZATION_LEVELS = ["minimal", "standard", "aggressive"] as const;

type BugReportArgs = {
  includeSession?: boolean;
  logLines?: number;
  output?: string;
  skipDiagnostics?: boolean;
  anonymization?: (typeof ANONYMIZATION_LEVELS)[number];
  nonInteractive?: boolean;
};

export const BugReportCommand = cmd({
  command: "bug-report",
  aliases: ["report"],
  describe: "Generate a crash report for debugging",
  builder: (yargs: Argv) => {
    return yargs
      .option("include-session", {
        type: "boolean",
        default: false,
        describe: "Include session conversation data (requires consent)",
      })
      .option("log-lines", {
        type: "number",
        default: 500,
        describe: "Number of log lines to include",
      })
      .option("output", {
        alias: "o",
        type: "string",
        describe: "Output path for the report archive",
      })
      .option("skip-diagnostics", {
        type: "boolean",
        default: false,
        describe: "Skip running health checks",
      })
      .option("anonymization", {
        type: "string",
        choices: ANONYMIZATION_LEVELS,
        default: "standard",
        describe: "Anonymization level: minimal, standard, aggressive",
      })
      .option("non-interactive", {
        alias: "y",
        type: "boolean",
        default: false,
        describe: "Skip interactive prompts",
      });
  },
  handler: async (args) => {
    try {
      const typedArgs = args as BugReportArgs;
      const anonymization = typedArgs.anonymization ?? "standard";
      if (!ANONYMIZATION_LEVELS.includes(anonymization)) {
        console.error(`Invalid anonymization level. Choose: ${ANONYMIZATION_LEVELS.join(", ")}`);
        process.exit(2);
      }

      let includeSession = typedArgs.includeSession ?? false;
      if (includeSession && !typedArgs.nonInteractive) {
        includeSession = await promptConsent(
          "Include session data? This may contain conversation content. (y/N): "
        );
      }

      const generator = new ReportGenerator({
        includeSession,
        logLines: typedArgs.logLines ?? 500,
        outputPath: typedArgs.output,
        skipDiagnostics: typedArgs.skipDiagnostics ?? false,
        anonymization,
        nonInteractive: typedArgs.nonInteractive ?? false,
      });

      const { archivePath } = await generator.generate();

      console.log("\n> Next steps:");
      console.log("   1. Review the report contents for any remaining sensitive data");
      console.log("   2. Create a GitHub issue at https://github.com/your-org/agent-core/issues");
      console.log("   3. Attach the report archive to the issue");
      console.log(`\n   Archive: ${archivePath}\n`);

      process.exit(0);
    } catch (error) {
      console.error(
        "Report generation failed:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(2);
    }
  },
});

async function promptConsent(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// Help examples
export const bugReportExamples = `
Examples:
  $ agent-core bug-report                     # Generate basic report
  $ agent-core bug-report --include-session   # Include session data (with consent)
  $ agent-core bug-report --log-lines 1000    # Include more log history
  $ agent-core bug-report -o ~/report.tar.gz  # Custom output path
  $ agent-core bug-report --anonymization aggressive  # Maximum privacy

Anonymization Levels:
  minimal    - Only redact API keys
  standard   - Redact keys, credentials, and usernames in paths
  aggressive - Also redact emails, phone numbers, IPs
`;
