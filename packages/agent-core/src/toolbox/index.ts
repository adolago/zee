/**
 * Toolbox - Executable Files as Tools
 *
 * Like Amp's toolbox system: a directory of executable files that
 * provide custom tools to the agent. Simpler than MCP servers,
 * easier for the agent to use than plain CLI tools.
 *
 * Protocol:
 * - TOOLBOX_ACTION=describe → Output: name, description, parameters (YAML)
 * - TOOLBOX_ACTION=execute → Input: parameters as YAML on stdin, Output: result
 *
 * Example tool (.agent-core/tools/run_tests):
 * ```bash
 * #!/usr/bin/env bash
 * if [ "$TOOLBOX_ACTION" = "describe" ]; then
 *   echo "name: run_tests"
 *   echo "description: Run tests in the project"
 *   echo "parameters:"
 *   echo "  testName: string (optional) - specific test to run"
 * else
 *   # Execute: read params from stdin
 *   read -r params
 *   npm test -- "$params"
 * fi
 * ```
 *
 * Toolbox directories (checked in order):
 * - .agent-core/tools/
 * - $AGENT_CORE_TOOLBOX (env var, colon-separated)
 * - ~/.config/agent-core/tools/
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { Flag } from "../flag/flag";
import { Log } from "../util/log";
import { Instance } from "../project/instance";

const log = Log.create({ service: "toolbox" });

export interface ToolboxTool {
  name: string;
  description: string;
  parameters: Record<string, ToolboxParam>;
  path: string;
  source: string; // Which toolbox directory
}

export interface ToolboxParam {
  type: "string" | "number" | "boolean";
  description?: string;
  optional?: boolean;
}

export interface ToolboxResult {
  output: string;
  exitCode: number;
}

/**
 * Get all toolbox directories
 */
export function getToolboxDirs(): string[] {
  const dirs: string[] = [];

  // Project-local toolbox
  dirs.push(path.join(Instance.directory, ".agent-core", "tools"));

  // Environment variable (colon-separated)
  const envToolbox = Flag.AGENT_CORE_TOOLBOX ?? process.env.AGENT_CORE_TOOLBOX;
  if (envToolbox) {
    dirs.push(...envToolbox.split(":").filter(Boolean));
  }

  // Global toolbox
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (home) {
    dirs.push(path.join(home, ".config", "agent-core", "tools"));
  }

  return dirs;
}

/**
 * Discover all tools in toolbox directories
 */
export async function discoverTools(): Promise<ToolboxTool[]> {
  const tools: ToolboxTool[] = [];
  const seen = new Set<string>();

  for (const dir of getToolboxDirs()) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && !seen.has(entry.name)) {
          const toolPath = path.join(dir, entry.name);
          try {
            const tool = await describeTool(toolPath, dir);
            if (tool) {
              tools.push(tool);
              seen.add(entry.name);
            }
          } catch (err) {
            log.debug("Failed to describe tool", {
              path: toolPath,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return tools;
}

/**
 * Get tool description by running with TOOLBOX_ACTION=describe
 */
async function describeTool(toolPath: string, source: string): Promise<ToolboxTool | null> {
  return new Promise((resolve) => {
    const proc = spawn(toolPath, [], {
      env: { ...process.env, TOOLBOX_ACTION: "describe" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });

    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      try {
        const tool = parseToolDescription(output, toolPath, source);
        resolve(tool);
      } catch {
        resolve(null);
      }
    });

    proc.on("error", () => resolve(null));
  });
}

/**
 * Parse tool description YAML
 */
function parseToolDescription(output: string, toolPath: string, source: string): ToolboxTool {
  const lines = output.split("\n");
  const tool: ToolboxTool = {
    name: path.basename(toolPath),
    description: "",
    parameters: {},
    path: toolPath,
    source,
  };

  let inParams = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("name:")) {
      tool.name = trimmed.slice(5).trim();
    } else if (trimmed.startsWith("description:")) {
      tool.description = trimmed.slice(12).trim();
    } else if (trimmed === "parameters:") {
      inParams = true;
    } else if (inParams && trimmed.includes(":")) {
      // Parse parameter: "paramName: type (optional) - description"
      const [paramPart, ...descParts] = trimmed.split("-");
      const [paramName, typePart] = paramPart.split(":").map((s) => s.trim());
      const typeMatch = typePart?.match(/^(string|number|boolean)(\s*\(optional\))?/i);
      if (paramName && typeMatch) {
        tool.parameters[paramName] = {
          type: typeMatch[1].toLowerCase() as "string" | "number" | "boolean",
          optional: !!typeMatch[2],
          description: descParts.join("-").trim() || undefined,
        };
      }
    }
  }

  return tool;
}

/**
 * Execute a toolbox tool
 */
export async function executeTool(
  tool: ToolboxTool,
  params: Record<string, unknown>
): Promise<ToolboxResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(tool.path, [], {
      env: { ...process.env, TOOLBOX_ACTION: "execute" },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });

    let output = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Send parameters as simple key: value lines
    const input = Object.entries(params)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    proc.stdin.write(input);
    proc.stdin.end();

    proc.on("close", (code) => {
      resolve({
        output: output || stderr,
        exitCode: code ?? 0,
      });
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Convert toolbox tool to Zod schema for tool registration
 */
export function toZodSchema(tool: ToolboxTool): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, param] of Object.entries(tool.parameters)) {
    let schema: z.ZodTypeAny;
    switch (param.type) {
      case "number":
        schema = z.number();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      default:
        schema = z.string();
    }

    if (param.description) {
      schema = schema.describe(param.description);
    }

    if (param.optional) {
      schema = schema.optional();
    }

    shape[name] = schema;
  }

  return z.object(shape);
}

/**
 * Get a tool by name
 */
export async function getTool(name: string): Promise<ToolboxTool | undefined> {
  const tools = await discoverTools();
  return tools.find((t) => t.name === name);
}

/**
 * Create a new tool from template
 */
export async function createTool(
  name: string,
  options?: { dir?: string; template?: "bash" | "node" | "python" }
): Promise<string> {
  const dir = options?.dir ?? path.join(Instance.directory, ".agent-core", "tools");
  const template = options?.template ?? "bash";

  await fs.mkdir(dir, { recursive: true });

  const toolPath = path.join(dir, name);

  const templates: Record<string, string> = {
    bash: `#!/usr/bin/env bash
# Toolbox tool: ${name}

if [ "$TOOLBOX_ACTION" = "describe" ]; then
  echo "name: ${name}"
  echo "description: TODO: Add description"
  echo "parameters:"
  echo "  arg1: string - TODO: describe this parameter"
else
  # Read parameters from stdin
  while IFS=': ' read -r key value; do
    case "$key" in
      arg1) ARG1="$value" ;;
    esac
  done
  
  # TODO: Implement tool logic
  echo "Running ${name} with arg1=$ARG1"
fi
`,
    node: `#!/usr/bin/env node
// Toolbox tool: ${name}

const action = process.env.TOOLBOX_ACTION;

if (action === 'describe') {
  console.log('name: ${name}');
  console.log('description: TODO: Add description');
  console.log('parameters:');
  console.log('  arg1: string - TODO: describe this parameter');
} else {
  // Read parameters from stdin
  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    const params = {};
    for (const line of input.split('\\n')) {
      const [key, ...rest] = line.split(': ');
      if (key) params[key.trim()] = rest.join(': ').trim();
    }
    
    // TODO: Implement tool logic
    console.log('Running ${name} with', params);
  });
}
`,
    python: `#!/usr/bin/env python3
# Toolbox tool: ${name}

import os
import sys

action = os.environ.get('TOOLBOX_ACTION', 'execute')

if action == 'describe':
    print('name: ${name}')
    print('description: TODO: Add description')
    print('parameters:')
    print('  arg1: string - TODO: describe this parameter')
else:
    # Read parameters from stdin
    params = {}
    for line in sys.stdin:
        if ': ' in line:
            key, value = line.strip().split(': ', 1)
            params[key] = value
    
    # TODO: Implement tool logic
    print(f'Running ${name} with {params}')
`,
  };

  await fs.writeFile(toolPath, templates[template]);
  await fs.chmod(toolPath, 0o755);

  return toolPath;
}
