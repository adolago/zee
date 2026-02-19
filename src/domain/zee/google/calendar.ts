/**
 * Google Calendar Client for Zee
 *
 * Uses OAuth2 tokens from ~/.config/zee/credentials/google/ to fetch calendar events.
 */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { Zee } from "../../../paths";

const CREDENTIALS_DIR = join(Zee.credentials(), "google");
const OAUTH_CLIENT_PATH = join(CREDENTIALS_DIR, "oauth-client.json");
const TOKENS_PATH = join(CREDENTIALS_DIR, "tokens.json");

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

interface OAuthClient {
  installed: {
    client_id: string;
    client_secret: string;
    token_uri: string;
  };
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
  scope: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  status: string;
  htmlLink?: string;
}

interface CalendarList {
  items: Array<{
    id: string;
    summary: string;
    primary?: boolean;
    backgroundColor?: string;
  }>;
}

interface EventsResponse {
  items: CalendarEvent[];
  nextPageToken?: string;
  summary?: string;
}

export interface FormattedEvent {
  id: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
  isAllDay: boolean;
}

async function loadCredentials(): Promise<{ client: OAuthClient; tokens: Tokens }> {
  const [clientJson, tokensJson] = await Promise.all([
    readFile(OAUTH_CLIENT_PATH, "utf-8"),
    readFile(TOKENS_PATH, "utf-8"),
  ]);
  return {
    client: JSON.parse(clientJson) as OAuthClient,
    tokens: JSON.parse(tokensJson) as Tokens,
  };
}

async function saveTokens(tokens: Tokens): Promise<void> {
  await writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

async function refreshAccessToken(client: OAuthClient, tokens: Tokens): Promise<Tokens> {
  const response = await fetch(client.installed.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.installed.client_id,
      client_secret: client.installed.client_secret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh token: ${error}`);
  }

  const newTokenData = await response.json() as Record<string, unknown>;
  const updatedTokens: Tokens = {
    ...tokens,
    access_token: newTokenData.access_token as string,
    expiry_date: Date.now() + ((newTokenData.expires_in as number) || 3600) * 1000,
  };

  await saveTokens(updatedTokens);
  return updatedTokens;
}

async function getValidToken(): Promise<string> {
  const { client, tokens } = await loadCredentials();

  // Refresh if expired or expiring within 5 minutes
  if (Date.now() > tokens.expiry_date - 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(client, tokens);
    return refreshed.access_token;
  }

  return tokens.access_token;
}

async function calendarRequest<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const token = await getValidToken();
  const url = new URL(`${CALENDAR_API_BASE}${endpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Calendar API error (${response.status}): ${error}`);
  }

  return response.json() as T;
}

export async function listCalendars(): Promise<CalendarList["items"]> {
  const result = await calendarRequest<CalendarList>("/users/me/calendarList");
  return result.items;
}

export async function listEvents(
  calendarId: string = "primary",
  options: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    singleEvents?: boolean;
    orderBy?: "startTime" | "updated";
  } = {}
): Promise<CalendarEvent[]> {
  const params: Record<string, string> = {
    singleEvents: String(options.singleEvents ?? true),
    orderBy: options.orderBy ?? "startTime",
    maxResults: String(options.maxResults ?? 50),
  };

  if (options.timeMin) params.timeMin = options.timeMin;
  if (options.timeMax) params.timeMax = options.timeMax;

  const result = await calendarRequest<EventsResponse>(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    params
  );
  return result.items || [];
}

export async function getTodayEvents(calendarId: string = "primary"): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  return listEvents(calendarId, {
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
  });
}

export async function getWeekEvents(calendarId: string = "primary"): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Start from Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  return listEvents(calendarId, {
    timeMin: startOfWeek.toISOString(),
    timeMax: endOfWeek.toISOString(),
  });
}

export async function getMonthEvents(
  calendarId: string = "primary",
  year?: number,
  month?: number
): Promise<CalendarEvent[]> {
  const now = new Date();
  const targetYear = year ?? now.getFullYear();
  const targetMonth = month ?? now.getMonth();

  const startOfMonth = new Date(targetYear, targetMonth, 1);
  const endOfMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

  return listEvents(calendarId, {
    timeMin: startOfMonth.toISOString(),
    timeMax: endOfMonth.toISOString(),
  });
}

export function formatEventsForCanvas(events: CalendarEvent[]): FormattedEvent[] {
  return events.map((event) => {
    const startDateTime = event.start.dateTime || event.start.date;
    const endDateTime = event.end.dateTime || event.end.date;
    const isAllDay = !event.start.dateTime;

    let date = "";
    let startTime: string | undefined;
    let endTime: string | undefined;

    if (startDateTime) {
      const startDate = new Date(startDateTime);
      date = startDate.toISOString().split("T")[0];

      if (!isAllDay) {
        startTime = startDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });
        if (endDateTime) {
          const endDate = new Date(endDateTime);
          endTime = endDate.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
        }
      }
    }

    return {
      id: event.id,
      title: event.summary || "(No title)",
      date,
      startTime,
      endTime,
      location: event.location,
      description: event.description,
      isAllDay,
    };
  });
}

export async function checkCredentialsExist(): Promise<boolean> {
  try {
    await Promise.all([
      readFile(OAUTH_CLIENT_PATH),
      readFile(TOKENS_PATH),
    ]);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Event Management Functions
// =============================================================================

interface EventInput {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string }>;
}

export async function createEvent(
  calendarId: string = "primary",
  event: EventInput
): Promise<CalendarEvent> {
  const token = await getValidToken();
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create event: ${error}`);
  }

  return response.json() as Promise<CalendarEvent>;
}

export async function updateEvent(
  calendarId: string = "primary",
  eventId: string,
  updates: Partial<EventInput>
): Promise<CalendarEvent> {
  const token = await getValidToken();
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update event: ${error}`);
  }

  return response.json() as Promise<CalendarEvent>;
}

export async function deleteEvent(
  calendarId: string = "primary",
  eventId: string
): Promise<void> {
  const token = await getValidToken();
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete event: ${error}`);
  }
}

export async function quickAddEvent(
  calendarId: string = "primary",
  text: string
): Promise<CalendarEvent> {
  const token = await getValidToken();
  const url = new URL(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/quickAdd`);
  url.searchParams.set("text", text);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to quick add event: ${error}`);
  }

  return response.json() as Promise<CalendarEvent>;
}

// =============================================================================
// Smart Scheduling Functions
// =============================================================================

export interface TimeSlot {
  start: Date;
  end: Date;
  durationMinutes: number;
}

export interface MeetingSuggestion extends TimeSlot {
  score: number;
  reason: string;
}

export async function findFreeSlots(
  calendarId: string = "primary",
  options: {
    startDate: Date;
    endDate: Date;
    minDurationMinutes?: number;
    workingHoursStart?: number; // 0-23
    workingHoursEnd?: number;   // 0-23
  }
): Promise<TimeSlot[]> {
  const {
    startDate,
    endDate,
    minDurationMinutes = 30,
    workingHoursStart = 9,
    workingHoursEnd = 17,
  } = options;

  // Fetch events in the date range
  const events = await listEvents(calendarId, {
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });

  const slots: TimeSlot[] = [];
  let currentDay = new Date(startDate);
  currentDay.setHours(0, 0, 0, 0);

  while (currentDay < endDate) {
    // Get working hours for this day
    const dayStart = new Date(currentDay);
    dayStart.setHours(workingHoursStart, 0, 0, 0);

    const dayEnd = new Date(currentDay);
    dayEnd.setHours(workingHoursEnd, 0, 0, 0);

    // Find events on this day
    const dayEvents = events
      .filter((e) => {
        const eventStart = new Date(e.start.dateTime || e.start.date || "");
        return eventStart >= dayStart && eventStart < dayEnd;
      })
      .sort((a, b) => {
        const aStart = new Date(a.start.dateTime || a.start.date || "").getTime();
        const bStart = new Date(b.start.dateTime || b.start.date || "").getTime();
        return aStart - bStart;
      });

    // Find gaps between events
    let slotStart = dayStart;
    for (const event of dayEvents) {
      const eventStart = new Date(event.start.dateTime || event.start.date || "");
      const eventEnd = new Date(event.end.dateTime || event.end.date || "");

      if (eventStart > slotStart) {
        const durationMinutes = (eventStart.getTime() - slotStart.getTime()) / (1000 * 60);
        if (durationMinutes >= minDurationMinutes) {
          slots.push({
            start: new Date(slotStart),
            end: new Date(eventStart),
            durationMinutes: Math.floor(durationMinutes),
          });
        }
      }
      slotStart = new Date(Math.max(slotStart.getTime(), eventEnd.getTime()));
    }

    // Check remaining time until end of working hours
    if (slotStart < dayEnd) {
      const durationMinutes = (dayEnd.getTime() - slotStart.getTime()) / (1000 * 60);
      if (durationMinutes >= minDurationMinutes) {
        slots.push({
          start: new Date(slotStart),
          end: new Date(dayEnd),
          durationMinutes: Math.floor(durationMinutes),
        });
      }
    }

    // Move to next day
    currentDay.setDate(currentDay.getDate() + 1);
  }

  return slots;
}

export async function suggestMeetingTimes(
  calendarId: string = "primary",
  options: {
    durationMinutes: number;
    withinDays?: number;
    preferMorning?: boolean;
    preferAfternoon?: boolean;
    workingHoursStart?: number;
    workingHoursEnd?: number;
  }
): Promise<MeetingSuggestion[]> {
  const {
    durationMinutes,
    withinDays = 7,
    preferMorning = false,
    preferAfternoon = false,
    workingHoursStart = 9,
    workingHoursEnd = 17,
  } = options;

  const now = new Date();
  const startDate = new Date(now);
  startDate.setMinutes(Math.ceil(startDate.getMinutes() / 30) * 30); // Round up to next 30 min
  startDate.setSeconds(0, 0);

  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + withinDays);

  const freeSlots = await findFreeSlots(calendarId, {
    startDate,
    endDate,
    minDurationMinutes: durationMinutes,
    workingHoursStart,
    workingHoursEnd,
  });

  // Score and filter slots
  const suggestions: MeetingSuggestion[] = [];

  for (const slot of freeSlots) {
    if (slot.durationMinutes < durationMinutes) continue;

    const hour = slot.start.getHours();
    let score = 50; // Base score
    let reason = "Available";

    // Prefer slots that exactly fit the duration
    if (slot.durationMinutes === durationMinutes) {
      score += 10;
      reason = "Perfect fit";
    }

    // Morning preference (9-12)
    if (preferMorning && hour >= 9 && hour < 12) {
      score += 20;
      reason = "Morning slot";
    }

    // Afternoon preference (13-17)
    if (preferAfternoon && hour >= 13 && hour <= 17) {
      score += 20;
      reason = "Afternoon slot";
    }

    // Prefer mid-week
    const dayOfWeek = slot.start.getDay();
    if (dayOfWeek >= 2 && dayOfWeek <= 4) {
      score += 5;
    }

    // Prefer near-term slots
    const daysAway = (slot.start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysAway < 2) {
      score += 15;
      reason = "Soon";
    } else if (daysAway < 4) {
      score += 10;
    }

    suggestions.push({
      start: slot.start,
      end: new Date(slot.start.getTime() + durationMinutes * 60 * 1000),
      durationMinutes,
      score,
      reason,
    });
  }

  // Sort by score descending, return top 5
  return suggestions.sort((a, b) => b.score - a.score).slice(0, 5);
}
