# @zee/ai

Standalone multi-provider LLM API for Zee.

## Install

```bash
npm install @zee/ai
```

## Usage

```ts
import { getModel, stream } from "@zee/ai"

const model = getModel("openai", "gpt-4o-mini")
const events = stream(model, {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Hello" }],
})

for await (const event of events) {
  if (event.type === "text_delta") process.stdout.write(event.delta)
}
```
