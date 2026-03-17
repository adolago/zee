import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { OpenBBRoute } from "../../src/server/route/openbb"
import { tmpdir } from "../fixture/fixture"

function parseSse(body: string): Array<{ event?: string; data?: unknown }> {
  return body
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\n/)
      const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim()
      const dataLine = lines.find((line) => line.startsWith("data:"))?.slice("data:".length).trim()
      return {
        event,
        data: dataLine ? JSON.parse(dataLine) : undefined,
      }
    })
}

describe("OpenBBRoute", () => {
  test("serves the OpenBB Workspace agent descriptor", async () => {
    const response = await OpenBBRoute.request("/agents.json")

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      zee?: {
        name: string
        endpoints: {
          query: string
        }
        features: Record<string, boolean>
      }
    }

    expect(body.zee?.name).toBe("Zee")
    expect(body.zee?.endpoints.query).toBe("/openbb/query")
    expect(body.zee?.features["widget-dashboard-select"]).toBe(true)
    expect(body.zee?.features["widget-dashboard-search"]).toBe(true)
  })

  test("requests widget data before prompting when dashboard widgets are selected", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await OpenBBRoute.request("/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [
              {
                role: "human",
                content: "What is happening with AAPL?",
              },
            ],
            widgets: {
              primary: [
                {
                  uuid: "widget-1",
                  widget_id: "price-summary",
                  name: "Price Summary",
                  origin: "dashboard",
                  params: [
                    {
                      name: "symbol",
                      current_value: "AAPL",
                    },
                  ],
                },
              ],
            },
          }),
        })

        expect(response.status).toBe(200)
        const events = parseSse(await response.text())
        expect(events).toEqual([
          {
            event: "copilotFunctionCall",
            data: {
              function: "get_widget_data",
              input_arguments: {
                data_sources: [
                  {
                    widget_uuid: "widget-1",
                    origin: "dashboard",
                    id: "price-summary",
                    input_args: {
                      symbol: "AAPL",
                    },
                  },
                ],
              },
            },
          },
        ])
      },
    })
  })
})
