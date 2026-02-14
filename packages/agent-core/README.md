# @zee/agent-core

Standalone stateful agent runtime for Zee.

## Install

```bash
npm install @zee/agent-core @zee/ai
```

## Usage

```ts
import { Agent } from "@zee/agent-core"
import { getModel } from "@zee/ai"

const agent = new Agent({
  initialState: {
    systemPrompt: "You are helpful.",
    model: getModel("openai", "gpt-4o-mini"),
  },
})

await agent.prompt("List files in this repo")
```
