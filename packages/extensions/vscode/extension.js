const vscode = require("vscode");

function getWorkspaceDirectory() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return folders[0].uri.fsPath;
}

async function getBaseUrl(context) {
  const config = vscode.workspace.getConfiguration("agentCore");
  const defaultUrl = config.get("baseUrl");
  const stored = context.globalState.get("agentCore.baseUrl");
  return stored || defaultUrl;
}

async function setBaseUrl(context, url) {
  await context.globalState.update("agentCore.baseUrl", url);
}

async function request(context, path, options = {}) {
  const baseUrl = await getBaseUrl(context);
  const url = `${baseUrl}${path}`;
  const directory = getWorkspaceDirectory();
  const headers = {
    "Accept": "application/json",
    ...(directory ? { "x-agent-core-directory": directory, "x-opencode-directory": directory } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

async function ensureSession(context, output) {
  const existing = context.globalState.get("agentCore.sessionId");
  if (existing) return existing;
  const created = await request(context, "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  const sessionId = created.id;
  await context.globalState.update("agentCore.sessionId", sessionId);
  output.appendLine(`Created session ${sessionId}`);
  return sessionId;
}

function activate(context) {
  const output = vscode.window.createOutputChannel("Agent-Core");

  context.subscriptions.push(
    vscode.commands.registerCommand("agentCore.connect", async () => {
      const current = await getBaseUrl(context);
      const next = await vscode.window.showInputBox({
        prompt: "Agent-Core daemon URL",
        value: current || "http://127.0.0.1:3210",
      });
      if (!next) return;
      await setBaseUrl(context, next);
      output.appendLine(`Connected to ${next}`);
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agentCore.newSession", async () => {
      try {
        const created = await request(context, "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        await context.globalState.update("agentCore.sessionId", created.id);
        output.appendLine(`New session: ${created.id}`);
        output.show(true);
      } catch (err) {
        vscode.window.showErrorMessage(`Agent-Core: ${err.message || err}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agentCore.sendPrompt", async () => {
      try {
        const prompt = await vscode.window.showInputBox({ prompt: "Send prompt to Agent-Core" });
        if (!prompt) return;
        const sessionId = await ensureSession(context, output);
        const response = await request(context, `/session/${sessionId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: prompt }),
        });
        output.appendLine(`Response: ${JSON.stringify(response.info || response, null, 2)}`);
        output.show(true);
      } catch (err) {
        vscode.window.showErrorMessage(`Agent-Core: ${err.message || err}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agentCore.sendSelection", async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("No active editor.");
          return;
        }
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        if (!text.trim()) {
          vscode.window.showInformationMessage("No selection to send.");
          return;
        }
        const filePath = editor.document.fileName;
        const prompt = `File: ${filePath}\n\n${text}`;
        const sessionId = await ensureSession(context, output);
        const response = await request(context, `/session/${sessionId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: prompt }),
        });
        output.appendLine(`Response: ${JSON.stringify(response.info || response, null, 2)}`);
        output.show(true);
      } catch (err) {
        vscode.window.showErrorMessage(`Agent-Core: ${err.message || err}`);
      }
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
