# Security

## Threat Model

### Overview

Agent-Core is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### No Sandbox

Agent-Core does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking - it prompts for confirmation before executing commands, writing files, etc. However, it is not designed to provide security isolation.

If you need true isolation, run Agent-Core inside a Docker container or VM.

### Server Mode

Server mode requires authentication by default. Set `AGENT_CORE_SERVER_PASSWORD` (or `AGENT_CORE_SERVER_PASSWORD`) to configure HTTP Basic Auth. You can opt out with `AGENT_CORE_DISABLE_SERVER_AUTH=1`, but this is not recommended. It is the end user's responsibility to secure the server - any functionality it provides is not a vulnerability.

### Out of Scope

| Category                        | Rationale                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| **Server access when opted-in** | If you enable server mode, API access is expected behavior              |
| **Sandbox escapes**             | The permission system is not a sandbox (see above)                      |
| **LLM provider data handling**  | Data sent to your configured LLM provider is governed by their policies |
| **MCP server behavior**         | External MCP servers you configure are outside our trust boundary       |

---

# Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings.

Please contact the maintainers directly with a private report. Avoid sharing sensitive details in public issues.
