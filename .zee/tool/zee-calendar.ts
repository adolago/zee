/**
 * Zee Calendar Tool - Plugin wrapper for Google Calendar
 *
 * Wraps the Zee calendar tool in the plugin format.
 */

import { tool } from "@zee/plugin"

async function loadCalendarModule() {
  try {
    return await import("../../src/domain/zee/google/calendar.js")
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (!errorMsg.includes("Cannot find module") && !errorMsg.includes("ERR_MODULE_NOT_FOUND")) {
      throw error
    }
    return await import("../../src/domain/zee/google/calendar.ts")
  }
}

export default tool({
  description: `Google Calendar with smart scheduling.

**View Events:**
- today/week/month/list: View events
- show: Display calendar

**Manage Events:**
- create: Create event with { event: { summary, start, end, location?, attendees? } }
- update: Update event with { eventId, event: {...} }
- delete: Delete event with { eventId }
- quick-add: Natural language event creation { quickAddText: "Lunch with John tomorrow at noon" }

**Smart Scheduling:**
- suggest: Get optimal meeting time suggestions { durationMinutes, withinDays?, preferMorning?, preferAfternoon? }
- find-free: Find available time slots { dateRange: {start, end}, durationMinutes }

Examples:
- { action: "today" }
- { action: "create", event: { summary: "Team Meeting", start: "2026-01-15T10:00:00", end: "2026-01-15T11:00:00" } }
- { action: "suggest", durationMinutes: 30, preferMorning: true }
- { action: "quick-add", quickAddText: "Coffee with Sarah tomorrow 3pm" }`,
  args: {
    action: tool.schema
      .enum([
        "list",
        "today",
        "week",
        "month",
        "show",
        "create",
        "update",
        "delete",
        "suggest",
        "find-free",
        "quick-add",
      ])
      .describe("Calendar action"),
    dateRange: tool.schema
      .object({
        start: tool.schema.string(),
        end: tool.schema.string(),
      })
      .optional()
      .describe("Date range for 'list' or 'find-free' action (ISO dates)"),
    year: tool.schema.number().optional().describe("Year for 'month' action"),
    month: tool.schema
      .number()
      .min(0)
      .max(11)
      .optional()
      .describe("Month (0-11) for 'month' action"),
    event: tool.schema
      .object({
        summary: tool.schema.string().describe("Event title"),
        description: tool.schema.string().optional(),
        location: tool.schema.string().optional(),
        start: tool.schema.string().describe("Start time (ISO datetime or YYYY-MM-DD for all-day)"),
        end: tool.schema.string().describe("End time (ISO datetime or YYYY-MM-DD for all-day)"),
        attendees: tool.schema.array(tool.schema.string()).optional().describe("Attendee email addresses"),
      })
      .optional()
      .describe("Event details for create/update"),
    eventId: tool.schema.string().optional().describe("Event ID for update/delete"),
    durationMinutes: tool.schema.number().optional().describe("Meeting duration for 'suggest' action"),
    withinDays: tool.schema.number().optional().describe("Search window in days (default: 7)"),
    preferMorning: tool.schema.boolean().optional().describe("Prefer morning slots"),
    preferAfternoon: tool.schema.boolean().optional().describe("Prefer afternoon slots"),
    quickAddText: tool.schema.string().optional().describe("Natural language event for 'quick-add'"),
  },
  async execute(args) {
    // Dynamic import to avoid build-time dependency issues
    const calendar = await loadCalendarModule()

    const {
      action,
      dateRange,
      year,
      month,
      event,
      eventId,
      durationMinutes,
      withinDays,
      preferMorning,
      preferAfternoon,
      quickAddText,
    } = args

    // Check credentials first
    const hasCredentials = await calendar.checkCredentialsExist()
    if (!hasCredentials) {
      return `Google Calendar credentials not found.

Please set up OAuth credentials at:
  ~/.zee/credentials/google/oauth-client.json
  ~/.zee/credentials/google/tokens.json

You can create credentials at:
  https://console.cloud.google.com/apis/credentials

Required scopes:
  - https://www.googleapis.com/auth/calendar
  - https://www.googleapis.com/auth/calendar.events`
    }

    try {
      // Handle event management actions
      if (action === "create" && event) {
        const isAllDay = !event.start.includes("T")
        const created = await calendar.createEvent("primary", {
          summary: event.summary,
          description: event.description,
          location: event.location,
          start: isAllDay ? { date: event.start } : { dateTime: event.start },
          end: isAllDay ? { date: event.end } : { dateTime: event.end },
          attendees: event.attendees?.map((email) => ({ email })),
        })
        return `Created event: ${created.summary}
ID: ${created.id}
When: ${created.start.dateTime || created.start.date}
${created.location ? `Where: ${created.location}` : ""}
${created.htmlLink ? `Link: ${created.htmlLink}` : ""}`
      }

      if (action === "update" && eventId && event) {
        const isAllDay = event.start && !event.start.includes("T")
        const updated = await calendar.updateEvent("primary", eventId, {
          summary: event.summary,
          description: event.description,
          location: event.location,
          ...(event.start && { start: isAllDay ? { date: event.start } : { dateTime: event.start } }),
          ...(event.end && { end: isAllDay ? { date: event.end } : { dateTime: event.end } }),
          ...(event.attendees && { attendees: event.attendees.map((email) => ({ email })) }),
        })
        return `Updated event: ${updated.summary}
When: ${updated.start.dateTime || updated.start.date}`
      }

      if (action === "delete" && eventId) {
        await calendar.deleteEvent("primary", eventId)
        return `Deleted event: ${eventId}`
      }

      if (action === "quick-add" && quickAddText) {
        const created = await calendar.quickAddEvent("primary", quickAddText)
        return `Created: ${created.summary}
When: ${created.start.dateTime || created.start.date}
ID: ${created.id}`
      }

      // Handle smart scheduling actions
      if (action === "suggest") {
        const duration = durationMinutes || 30
        const suggestions = await calendar.suggestMeetingTimes("primary", {
          durationMinutes: duration,
          withinDays: withinDays || 7,
          preferMorning,
          preferAfternoon,
        })

        if (suggestions.length === 0) {
          return `No ${duration}-minute slots available in the next ${withinDays || 7} days.`
        }

        const suggestionsList = suggestions
          .map((s, i) => {
            const startStr = s.start.toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
            const endStr = s.end.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })
            return `${i + 1}. ${startStr} - ${endStr} (${s.reason}, score: ${s.score})`
          })
          .join("\n")

        return `Best times for a ${duration}-minute meeting:

${suggestionsList}

To schedule, use: { action: "create", event: { summary: "...", start: "<ISO>", end: "<ISO>" } }`
      }

      if (action === "find-free" && dateRange && durationMinutes) {
        const slots = await calendar.findFreeSlots("primary", {
          startDate: new Date(dateRange.start),
          endDate: new Date(dateRange.end),
          minDurationMinutes: durationMinutes,
        })

        if (slots.length === 0) {
          return `No ${durationMinutes}-minute free slots between ${dateRange.start} and ${dateRange.end}.`
        }

        const slotsList = slots
          .slice(0, 10)
          .map((s) => {
            const startStr = s.start.toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
            const endStr = s.end.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })
            return `• ${startStr} - ${endStr} (${s.durationMinutes} min available)`
          })
          .join("\n")

        return `Found ${slots.length} free slot(s) of ${durationMinutes}+ minutes:

${slotsList}${slots.length > 10 ? `\n... and ${slots.length - 10} more` : ""}`
      }

      // Handle view actions
      let events: calendar.FormattedEvent[] = []
      let periodLabel = ""

      if (action === "show") {
        periodLabel = "Calendar"
      } else if (action === "today") {
        const raw = await calendar.getTodayEvents()
        events = calendar.formatEventsForCanvas(raw)
        periodLabel = "Today"
      } else if (action === "week") {
        const raw = await calendar.getWeekEvents()
        events = calendar.formatEventsForCanvas(raw)
        periodLabel = "This Week"
      } else if (action === "month") {
        const raw = await calendar.getMonthEvents("primary", year, month)
        events = calendar.formatEventsForCanvas(raw)
        const targetDate = new Date(year ?? new Date().getFullYear(), month ?? new Date().getMonth(), 1)
        periodLabel = targetDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      } else if (action === "list" && dateRange) {
        const raw = await calendar.listEvents("primary", {
          timeMin: new Date(dateRange.start).toISOString(),
          timeMax: new Date(dateRange.end).toISOString(),
        })
        events = calendar.formatEventsForCanvas(raw)
        periodLabel = `${dateRange.start} to ${dateRange.end}`
      }

      // Format events for display
      const eventsList =
        events.length > 0
          ? events
              .map((e) => {
                const time = e.isAllDay ? "All day" : `${e.startTime}${e.endTime ? ` - ${e.endTime}` : ""}`
                const loc = e.location ? ` @ ${e.location}` : ""
                return `• ${e.date} ${time}: ${e.title}${loc}`
              })
              .join("\n")
          : "No events found."

      return `${periodLabel} - ${events.length} event(s)

${eventsList}`
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage.includes("401") || errorMessage.includes("invalid_grant")) {
        return `Google Calendar authentication failed. Re-authenticate at ~/.zee/credentials/google/`
      }

      return `Calendar operation failed: ${errorMessage}`
    }
  },
})
