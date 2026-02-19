import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./get_search_content.txt"
import { getSearchContentResponse, selectSearchContentItem } from "./content-store"
import { wrapExternalContent } from "../security/external-content"

const GetSearchContentParameters = z
  .object({
    responseId: z.string().describe("The responseId returned by fetch_content."),
    url: z.string().optional().describe("Optional exact URL selector within the stored response."),
    urlIndex: z.number().int().nonnegative().optional().describe("Optional zero-based URL index selector."),
  })
  .superRefine((value, ctx) => {
    if (value.url && typeof value.urlIndex === "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either `url` or `urlIndex`, not both.",
      })
    }
  })

export const GetSearchContentTool = Tool.define("get_search_content", {
  description: DESCRIPTION,
  parameters: GetSearchContentParameters,
  async execute(params, ctx) {
    const response = await getSearchContentResponse(ctx.sessionID, params.responseId)
    const { item, index } = selectSearchContentItem(response, {
      url: params.url,
      urlIndex: params.urlIndex,
    })

    const wrapped = wrapExternalContent(item.content, {
      source: "web",
      includeNotice: true,
      scanPatterns: true,
    })

    const lines = [
      `responseId: ${response.responseId}`,
      `item: ${index + 1}/${response.items.length}`,
      `url: ${item.url}`,
      `title: ${item.title ?? "(none)"}`,
      `contentType: ${item.contentType ?? "unknown"}`,
      "",
      wrapped,
    ]

    return {
      title: `Retrieved content item ${index + 1}`,
      output: lines.join("\n"),
      metadata: {
        responseId: response.responseId,
        url: item.url,
        urlIndex: index,
        contentType: item.contentType,
      },
    }
  },
})
