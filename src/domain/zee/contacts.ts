/**
 * Zee Contacts Tool
 *
 * Personal contact management backed by Zee local semantic memory.
 * Contacts are stored as structured facts in the "contacts" domain,
 * enabling semantic search by name, relationship, context, or any detail.
 *
 * Ported from OpenClaw contact management patterns.
 */

import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types.js";
import { getMemory } from "../../memory/unified.js";
import { withRetry, buildEscalation } from "../../swarm/recovery.js";

// =============================================================================
// Schemas
// =============================================================================

const CONTACT_DOMAIN = "contacts";

const ContactFields = z.object({
  name: z.string().describe("Full name of the contact"),
  phone: z.string().optional().describe("Phone number (E.164 preferred, e.g. +15551234567)"),
  email: z.string().optional().describe("Email address"),
  relationship: z.string().optional().describe("Relationship (e.g. friend, colleague, family, doctor)"),
  organization: z.string().optional().describe("Company or organization"),
  notes: z.string().optional().describe("Free-form notes about this contact"),
  tags: z.array(z.string()).optional().describe("Tags for categorization (e.g. work, personal, vip)"),
});

const ContactsParams = z.object({
  action: z.enum(["store", "search", "list", "update", "delete"])
    .describe("Action: store (new contact), search (find by query), list (all contacts), update (modify existing), delete (remove)"),

  // For store and update
  contact: ContactFields.optional()
    .describe("Contact details (required for store/update)"),

  // For search
  query: z.string().optional()
    .describe("Search query (required for search). Semantic: 'my dentist', 'people at Acme Corp', 'friends in NYC'"),

  // For update and delete
  memoryId: z.string().optional()
    .describe("Memory ID of the contact to update or delete"),

  // Pagination
  limit: z.number().default(20).describe("Maximum results"),
});

// =============================================================================
// Helpers
// =============================================================================

function formatContactContent(contact: z.infer<typeof ContactFields>): string {
  const parts: string[] = [`Name: ${contact.name}`];
  if (contact.phone) parts.push(`Phone: ${contact.phone}`);
  if (contact.email) parts.push(`Email: ${contact.email}`);
  if (contact.relationship) parts.push(`Relationship: ${contact.relationship}`);
  if (contact.organization) parts.push(`Organization: ${contact.organization}`);
  if (contact.notes) parts.push(`Notes: ${contact.notes}`);
  if (contact.tags?.length) parts.push(`Tags: ${contact.tags.join(", ")}`);
  return parts.join("\n");
}

function parseContactFromContent(content: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const line of content.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    if (!value) continue;
    if (key === "tags") {
      result[key] = value.split(",").map((t) => t.trim()).filter(Boolean);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function formatContactEntry(entry: { id: string; memoryId?: string; content: string; createdAt: number }, idx: number): string {
  const parsed = parseContactFromContent(entry.content);
  const name = parsed.name || "(unknown)";
  const phone = parsed.phone ? ` | ${parsed.phone}` : "";
  const email = parsed.email ? ` | ${parsed.email}` : "";
  const rel = parsed.relationship ? ` (${parsed.relationship})` : "";
  const date = new Date(entry.createdAt).toLocaleDateString();
  return `${idx + 1}. ${name}${rel}${phone}${email}\n   Added: ${date} | ID: ${entry.memoryId ?? entry.id}`;
}

// =============================================================================
// Tool
// =============================================================================

export const contactsTool: ToolDefinition = {
  id: "zee:contacts",
  category: "domain",
  init: async () => ({
    description: `Manage personal contacts. Always search contacts before asking the user for someone's phone/email.

Actions:
- store: Save a new contact { contact: { name, phone?, email?, relationship?, organization?, notes?, tags? } }
- search: Find contacts { query: "my dentist" or "people at Acme" }
- list: List all contacts { limit?: 20 }
- update: Update a contact { memoryId: "...", contact: { name, ...fields to update } }
- delete: Remove a contact { memoryId: "..." }`,
    parameters: ContactsParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const { action, contact, query, memoryId, limit } = args;

      ctx.metadata({ title: `Contacts: ${action}` });

      try {
        const store = getMemory();

        // ---- STORE ----
        if (action === "store") {
          if (!contact?.name) {
            return {
              title: "Missing Contact",
              metadata: { action, error: "missing_name" },
              output: "Provide contact.name to store a contact.",
            };
          }

          const content = formatContactContent(contact);
          const nameLower = contact.name.toLowerCase().replace(/\s+/g, "-");

          const saveResult = await withRetry(
            () => store.save({
              category: "fact",
              content,
              namespace: "zee",
              metadata: {
                importance: 0.8,
                tags: [...(contact.tags ?? []), "contact"],
                agent: "zee",
                entities: [contact.name],
              },
              domain: CONTACT_DOMAIN,
              topic: nameLower,
              kind: "curated",
              priority: "high",
            }),
            { toolName: "zee:contacts", maxAttempts: 2 },
          );

          if ("error" in saveResult) {
            return {
              title: "Contact Store Failed",
              metadata: { error: saveResult.error.message },
              output: buildEscalation(saveResult.error, "zee:contacts"),
            };
          }

          const entry = saveResult.result;
          return {
            title: "Contact Saved",
            metadata: { id: entry.id, memoryId: entry.memoryId, name: contact.name },
            output: `Saved contact: ${contact.name}\nID: ${entry.memoryId ?? entry.id}\n\n${content}`,
          };
        }

        // ---- SEARCH ----
        if (action === "search") {
          if (!query) {
            return {
              title: "Missing Query",
              metadata: { action, error: "missing_query" },
              output: "Provide 'query' to search contacts.",
            };
          }

          const results = await store.search({
            query,
            namespace: "zee",
            limit: limit ?? 10,
            threshold: 0.4,
            domain: CONTACT_DOMAIN,
          });

          if (results.length === 0) {
            return {
              title: "No Contacts Found",
              metadata: { action, query, count: 0 },
              output: `No contacts matching: "${query}"\n\nStore a contact with: { action: "store", contact: { name: "...", phone: "..." } }`,
            };
          }

          const list = results.map((r, i) => {
            const score = (r.score * 100).toFixed(0);
            const base = formatContactEntry(r.entry, i);
            return `${base} | Match: ${score}%`;
          }).join("\n\n");

          return {
            title: `${results.length} Contact(s)`,
            metadata: { action, query, count: results.length },
            output: `Contacts matching "${query}":\n\n${list}`,
          };
        }

        // ---- LIST ----
        if (action === "list") {
          const results = await store.agenticSearch({
            domain: CONTACT_DOMAIN,
            namespace: "zee",
            limit: limit ?? 20,
          });

          if (results.length === 0) {
            return {
              title: "No Contacts",
              metadata: { action, count: 0 },
              output: "No contacts stored yet.\n\nStore one with: { action: \"store\", contact: { name: \"...\", phone: \"...\" } }",
            };
          }

          const list = results.map((r, i) => formatContactEntry(r.entry, i)).join("\n\n");

          return {
            title: `${results.length} Contact(s)`,
            metadata: { action, count: results.length },
            output: `All contacts:\n\n${list}`,
          };
        }

        // ---- UPDATE ----
        if (action === "update") {
          if (!memoryId) {
            return {
              title: "Missing ID",
              metadata: { action, error: "missing_id" },
              output: "Provide 'memoryId' to update a contact. Use search or list to find it.",
            };
          }
          if (!contact?.name) {
            return {
              title: "Missing Contact",
              metadata: { action, error: "missing_contact" },
              output: "Provide contact details (at minimum 'name') for the update.",
            };
          }

          const content = formatContactContent(contact);
          const nameLower = contact.name.toLowerCase().replace(/\s+/g, "-");

          const saveResult = await withRetry(
            () => store.save({
              category: "fact",
              content,
              namespace: "zee",
              metadata: {
                importance: 0.8,
                tags: [...(contact.tags ?? []), "contact"],
                agent: "zee",
                entities: [contact.name],
              },
              domain: CONTACT_DOMAIN,
              topic: nameLower,
              memoryId,
              kind: "curated",
              priority: "high",
            }),
            { toolName: "zee:contacts", maxAttempts: 2 },
          );

          if ("error" in saveResult) {
            return {
              title: "Contact Update Failed",
              metadata: { error: saveResult.error.message },
              output: buildEscalation(saveResult.error, "zee:contacts"),
            };
          }

          const entry = saveResult.result;
          const verStr = entry.version && entry.version > 1 ? ` (v${entry.version})` : "";

          return {
            title: `Contact Updated${verStr}`,
            metadata: { id: entry.id, memoryId: entry.memoryId, version: entry.version },
            output: `Updated contact: ${contact.name}${verStr}\nID: ${entry.memoryId ?? entry.id}\n\n${content}`,
          };
        }

        // ---- DELETE ----
        if (action === "delete") {
          if (!memoryId) {
            return {
              title: "Missing ID",
              metadata: { action, error: "missing_id" },
              output: "Provide 'memoryId' to delete a contact. Use search or list to find it.",
            };
          }

          const existing = await store.get(memoryId);
          if (!existing) {
            return {
              title: "Contact Not Found",
              metadata: { action, memoryId },
              output: `No contact found with ID: ${memoryId}`,
            };
          }

          await store.delete(memoryId);
          const parsed = parseContactFromContent(existing.content);
          const name = parsed.name || memoryId;

          return {
            title: "Contact Deleted",
            metadata: { action, memoryId, name },
            output: `Deleted contact: ${name}`,
          };
        }

        return {
          title: "Unknown Action",
          metadata: { action },
          output: `Unknown contacts action: ${action}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed")) {
          return {
            title: "Memory Unavailable",
            metadata: { error: "connection_failed" },
            output: `Could not connect to local memory storage. Error: ${errorMsg}`,
          };
        }
        return {
          title: "Contacts Error",
          metadata: { error: errorMsg },
          output: `Contacts operation failed: ${errorMsg}`,
        };
      }
    },
  }),
};

// =============================================================================
// Exports
// =============================================================================

export const CONTACTS_TOOLS = [contactsTool];
