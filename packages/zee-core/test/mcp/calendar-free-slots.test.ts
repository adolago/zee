import { test, expect } from "bun:test"
import { registerCalendarTools, type CalendarDeps } from "../../../../src/mcp/servers/calendar-tools"

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

test("calendar_free_slots forwards working hours to findFreeSlots", async () => {
  const handlers = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _description: string, _schema: Record<string, unknown>, handler: ToolHandler) => {
      handlers.set(name, handler)
    },
  }

  const findFreeSlotsCalls: Array<{ calendarId?: string; options: Record<string, unknown> }> = []

  const deps: CalendarDeps = {
    checkCredentialsExist: async () => true,
    findFreeSlots: async (calendarId, options) => {
      findFreeSlotsCalls.push({ calendarId, options })
      return []
    },
    getTodayEvents: async () => [],
    getWeekEvents: async () => [],
    getMonthEvents: async () => [],
    listEvents: async () => [],
    createEvent: async () => ({ id: "evt", summary: "stub", start: {}, end: {}, status: "confirmed" }),
    updateEvent: async () => ({ id: "evt", summary: "stub", start: {}, end: {}, status: "confirmed" }),
    deleteEvent: async () => {},
    quickAddEvent: async () => ({ id: "evt", summary: "stub", start: {}, end: {}, status: "confirmed" }),
  }

  registerCalendarTools(server, deps)

  const handler = handlers.get("calendar_free_slots")
  expect(handler).toBeDefined()

  await handler!({
    startDate: "2025-01-01T00:00:00.000Z",
    endDate: "2025-01-02T00:00:00.000Z",
    durationMinutes: 45,
    startHour: 8,
    endHour: 18,
  })

  expect(findFreeSlotsCalls.length).toBe(1)
  const call = findFreeSlotsCalls[0]
  expect(call.calendarId ?? "primary").toBe("primary")
  expect(call.options).toMatchObject({
    minDurationMinutes: 45,
    workingHoursStart: 8,
    workingHoursEnd: 18,
  })
  expect("preferences" in call.options).toBe(false)
})
