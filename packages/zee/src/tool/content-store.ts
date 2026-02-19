import { Identifier } from "../id/id"
import { Storage } from "../storage/storage"

const STORE_NAMESPACE = "search_content"

export type SearchContentMeta = Record<string, unknown>

export type SearchContentItem = {
  url: string
  title?: string
  contentType?: string
  content: string
  preview: string
  meta?: SearchContentMeta
}

export type SearchContentResponse = {
  responseId: string
  sourceTool: string
  sessionID: string
  createdAt: number
  items: SearchContentItem[]
}

function key(sessionID: string, responseId: string): string[] {
  return [STORE_NAMESPACE, sessionID, responseId]
}

export async function saveSearchContentResponse(input: {
  sessionID: string
  sourceTool: string
  items: SearchContentItem[]
  responseId?: string
}): Promise<SearchContentResponse> {
  const responseId = input.responseId ?? Identifier.ascending("tool")
  const record: SearchContentResponse = {
    responseId,
    sourceTool: input.sourceTool,
    sessionID: input.sessionID,
    createdAt: Date.now(),
    items: input.items,
  }
  await Storage.write(key(input.sessionID, responseId), record)
  return record
}

export async function getSearchContentResponse(sessionID: string, responseId: string): Promise<SearchContentResponse> {
  try {
    return await Storage.read<SearchContentResponse>(key(sessionID, responseId))
  } catch (error) {
    if (error instanceof Storage.NotFoundError) {
      throw new Error(`No stored content found for responseId "${responseId}" in this session.`)
    }
    throw error
  }
}

export function selectSearchContentItem(
  response: SearchContentResponse,
  selector: {
    url?: string
    urlIndex?: number
  } = {},
): { item: SearchContentItem; index: number } {
  if (!response.items.length) {
    throw new Error(`Stored response "${response.responseId}" has no content items.`)
  }

  if (selector.url) {
    const index = response.items.findIndex((item) => item.url === selector.url)
    if (index === -1) {
      const knownUrls = response.items.map((item) => item.url).join(", ")
      throw new Error(
        `No content item found for url "${selector.url}" in response "${response.responseId}". Known URLs: ${knownUrls}`,
      )
    }
    return { item: response.items[index], index }
  }

  if (typeof selector.urlIndex === "number") {
    if (selector.urlIndex < 0 || selector.urlIndex >= response.items.length) {
      throw new Error(
        `urlIndex ${selector.urlIndex} is out of range for response "${response.responseId}" (items: ${response.items.length}).`,
      )
    }
    return { item: response.items[selector.urlIndex], index: selector.urlIndex }
  }

  return { item: response.items[0], index: 0 }
}
