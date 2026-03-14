type ModelsCatalogProvider = {
  models?: Record<string, unknown>
  [key: string]: unknown
}

function skipWhitespace(input: string, index: number) {
  let cursor = index
  while (cursor < input.length && /\s/.test(input[cursor]!)) {
    cursor += 1
  }
  return cursor
}

function readJsonString(input: string, index: number) {
  let cursor = index + 1
  let escaped = false
  while (cursor < input.length) {
    const char = input[cursor]!
    cursor += 1
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "\"") {
      return {
        value: JSON.parse(input.slice(index, cursor)) as string,
        end: cursor,
      }
    }
  }
  throw new Error("Unterminated JSON string")
}

function readJsonObject(input: string, index: number) {
  let cursor = index
  let depth = 0
  let inString = false
  let escaped = false

  while (cursor < input.length) {
    const char = input[cursor]!
    cursor += 1

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === "\"") {
        inString = false
      }
      continue
    }

    if (char === "\"") {
      inString = true
      continue
    }

    if (char === "{") {
      depth += 1
      continue
    }

    if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return {
          value: JSON.parse(input.slice(index, cursor)) as ModelsCatalogProvider,
          end: cursor,
        }
      }
    }
  }

  throw new Error("Unterminated JSON object")
}

function mergeProvider(existing: ModelsCatalogProvider | undefined, next: ModelsCatalogProvider): ModelsCatalogProvider {
  return {
    ...existing,
    ...next,
    models: {
      ...(existing?.models ?? {}),
      ...(next.models ?? {}),
    },
  }
}

export function parseModelsCatalog(raw: string): Record<string, ModelsCatalogProvider> {
  const input = raw.trim()
  let cursor = skipWhitespace(input, 0)
  if (input[cursor] !== "{") {
    throw new Error("Expected models catalog JSON object")
  }
  cursor += 1

  const catalog: Record<string, ModelsCatalogProvider> = {}

  while (cursor < input.length) {
    cursor = skipWhitespace(input, cursor)
    if (input[cursor] === "}") {
      return catalog
    }

    if (input[cursor] !== "\"") {
      throw new Error(`Expected provider key at offset ${cursor}`)
    }

    const key = readJsonString(input, cursor)
    cursor = skipWhitespace(input, key.end)

    if (input[cursor] !== ":") {
      throw new Error(`Expected ':' after provider key at offset ${cursor}`)
    }
    cursor = skipWhitespace(input, cursor + 1)

    if (input[cursor] !== "{") {
      throw new Error(`Expected provider object at offset ${cursor}`)
    }

    const provider = readJsonObject(input, cursor)
    catalog[key.value] = mergeProvider(catalog[key.value], provider.value)

    cursor = skipWhitespace(input, provider.end)
    if (input[cursor] === ",") {
      cursor += 1
      continue
    }
    if (input[cursor] === "}") {
      return catalog
    }
  }

  throw new Error("Unterminated models catalog")
}

export function normalizeModelsCatalogJson(raw: string) {
  return JSON.stringify(parseModelsCatalog(raw), null, 2)
}
