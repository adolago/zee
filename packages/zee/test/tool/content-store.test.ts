import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import {
  getSearchContentResponse,
  saveSearchContentResponse,
  selectSearchContentItem,
  type SearchContentResponse,
} from "../../src/tool/content-store"

describe("tool.content-store", () => {
  test("saves and loads stored content by responseId", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const saved = await saveSearchContentResponse({
          sessionID: "session-1",
          sourceTool: "fetch_content",
          items: [
            {
              url: "https://example.com/a",
              title: "A",
              contentType: "text/plain",
              content: "alpha",
              preview: "alpha",
            },
            {
              url: "https://example.com/b",
              title: "B",
              contentType: "text/plain",
              content: "beta",
              preview: "beta",
            },
          ],
        })

        expect(saved.responseId.startsWith("tool_")).toBe(true)
        expect(saved.items.length).toBe(2)

        const loaded = await getSearchContentResponse("session-1", saved.responseId)
        expect(loaded.responseId).toBe(saved.responseId)
        expect(loaded.sourceTool).toBe("fetch_content")
        expect(loaded.items[0].content).toBe("alpha")
      },
    })
  })

  test("selects by default, url, and urlIndex", () => {
    const response: SearchContentResponse = {
      responseId: "tool_test",
      sessionID: "session-2",
      sourceTool: "fetch_content",
      createdAt: Date.now(),
      items: [
        {
          url: "https://example.com/a",
          content: "alpha",
          preview: "alpha",
        },
        {
          url: "https://example.com/b",
          content: "beta",
          preview: "beta",
        },
      ],
    }

    const first = selectSearchContentItem(response)
    expect(first.index).toBe(0)
    expect(first.item.content).toBe("alpha")

    const byUrl = selectSearchContentItem(response, { url: "https://example.com/b" })
    expect(byUrl.index).toBe(1)
    expect(byUrl.item.content).toBe("beta")

    const byIndex = selectSearchContentItem(response, { urlIndex: 1 })
    expect(byIndex.index).toBe(1)
    expect(byIndex.item.content).toBe("beta")
  })

  test("throws helpful errors for missing selectors", () => {
    const response: SearchContentResponse = {
      responseId: "tool_test",
      sessionID: "session-3",
      sourceTool: "fetch_content",
      createdAt: Date.now(),
      items: [
        {
          url: "https://example.com/a",
          content: "alpha",
          preview: "alpha",
        },
      ],
    }

    expect(() => selectSearchContentItem(response, { url: "https://example.com/missing" })).toThrow(
      'No content item found for url "https://example.com/missing"',
    )
    expect(() => selectSearchContentItem(response, { urlIndex: 9 })).toThrow("urlIndex 9 is out of range")
  })
})
