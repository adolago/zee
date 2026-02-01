import { writeFileSync, readdirSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Configuration
const PLAN_DIR = process.env.AGENT_CORE_PLAN_DIR || join(homedir(), ".agent-core", "plan");

// Ensure plan directory exists
if (!existsSync(PLAN_DIR)) {
  mkdirSync(PLAN_DIR, { recursive: true });
}

// Helpers
function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function sanitizeFilename(title: string) {
  return title.replace(/[^a-z0-9-]/gi, "_").toLowerCase();
}

// Commands
function listPlans() {
  const files = readdirSync(PLAN_DIR).filter((f) => f.endsWith(".md")).sort().reverse();
  if (files.length === 0) {
    console.log("No plans found.");
    return;
  }
  console.log(`\nFound ${files.length} plans in ${PLAN_DIR}:\n`);
  files.slice(0, 10).forEach((f) => console.log(`- ${f}`));
}

function createPlan(title: string, content: string) {
  const filename = `${getTimestamp()}-${sanitizeFilename(title)}.md`;
  const path = join(PLAN_DIR, filename);

  const fullContent = `# ${title}\n\n**Created:** ${new Date().toLocaleString()}\n**Status:** Draft\n\n${content}`;

  writeFileSync(path, fullContent);
  console.log(`\nPlan created: ${filename}`);
  console.log(`Path: ${path}`);
}

function readPlan(filename: string) {
  const path = join(PLAN_DIR, filename);
  if (!existsSync(path)) {
    console.error(`Plan not found: ${filename}`);
    process.exit(1);
  }
  console.log(readFileSync(path, "utf-8"));
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "list":
    listPlans();
    break;
  case "create":
    const titleIdx = args.indexOf("--title");
    const contentIdx = args.indexOf("--content");

    if (titleIdx === -1 || contentIdx === -1) {
      console.error("Usage: plan create --title <title> --content <content>");
      process.exit(1);
    }

    const title = args[titleIdx + 1];
    const content = args[contentIdx + 1];
    createPlan(title, content);
    break;
  case "read":
    const file = args[1];
    if (!file) {
      console.error("Usage: plan read <filename>");
      process.exit(1);
    }
    readPlan(file);
    break;
  default:
    console.log(`
Zee Planning Tool

Commands:
  list                                List recent plans
  create --title <t> --content <c>    Create a new plan
  read <filename>                     Read a plan
`);
}
