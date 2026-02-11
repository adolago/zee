import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Storage } from "../storage/storage"
import { Log } from "@/util/log"

export namespace Todo {
  const log = Log.create({ service: "session:todo" })
  // Input schema with optional fields and defaults - used by tools
  export const InfoInput = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().default("pending").describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().default("medium").describe("Priority level of the task: high, medium, low"),
      id: z.string().optional().describe("Unique identifier for the todo item (auto-generated if not provided)"),
    })
    .meta({ ref: "TodoInput" })

  // Full schema with all required fields - used for storage/events
  export const Info = z
    .object({
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
      id: z.string().describe("Unique identifier for the todo item"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  // Transform input to full Info (fills in defaults and generates id)
  export function normalize(input: z.infer<typeof InfoInput>): Info {
    return {
      content: input.content,
      status: input.status,
      priority: input.priority,
      id: input.id ?? `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }
  }

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: z.string(),
        todos: z.array(Info),
      }),
    ),
  }

  export async function update(input: { sessionID: string; todos: Info[] }) {
    await Storage.write(["todo", input.sessionID], input.todos)
    Bus.publish(Event.Updated, input)
  }

  export async function get(sessionID: string) {
    return Storage.read<Info[]>(["todo", sessionID])
      .then((x) => x || [])
      .catch((error) => {
        log.debug("Failed to read todos", {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        })
        return []
      })
  }
}
