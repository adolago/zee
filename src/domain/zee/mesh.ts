import { z } from "zod";
import type { ToolDefinition, ToolExecutionResult } from "../../mcp/types";
import {
  listMeshPeers,
  listMeshReservations,
  releaseMeshPaths,
  reserveMeshPaths,
  upsertMeshPeer,
} from "../../mcp/coordination/mesh-reservations.js";

function formatExpiry(expiresAt: number): string {
  return new Date(expiresAt).toISOString();
}

const MeshPeerParams = z.object({
  action: z.enum(["heartbeat", "list"]).default("list").describe("Mesh peer operation"),
  peerId: z.string().optional().describe("Peer identifier (defaults to <agent>:<sessionId>)"),
  label: z.string().optional().describe("Human label for this peer"),
  capabilities: z.array(z.string()).optional().describe("Declared mesh capabilities"),
  ttlMinutes: z.number().int().min(1).max(240).default(10).describe("Peer heartbeat TTL in minutes"),
});

export const meshPeerTool: ToolDefinition = {
  id: "zee:mesh-peer",
  category: "domain",
  init: async () => ({
    description: `Mesh peer control. Use heartbeat to register/update this session as an active mesh peer; list to show active peers.`,
    parameters: MeshPeerParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      ctx.metadata({ title: `Mesh Peer: ${args.action}` });

      if (args.action === "heartbeat") {
        const peerId = args.peerId?.trim() || `${ctx.agent}:${ctx.sessionId}`;
        const peer = await upsertMeshPeer({
          peerId,
          label: args.label,
          capabilities: args.capabilities,
          ttlMs: args.ttlMinutes * 60 * 1000,
          metadata: {
            agent: ctx.agent,
            sessionId: ctx.sessionId,
            surface: typeof ctx.extra?.surface === "string" ? ctx.extra.surface : undefined,
          },
        });
        return {
          title: "Mesh Peer Heartbeat",
          metadata: {
            peerId: peer.id,
            expiresAt: peer.expiresAt,
            capabilityCount: peer.capabilities.length,
          },
          output: `Peer ${peer.id} is active until ${formatExpiry(peer.expiresAt)}.`,
        };
      }

      const peers = await listMeshPeers();
      if (peers.length === 0) {
        return {
          title: "Mesh Peers",
          metadata: { count: 0 },
          output: "No active mesh peers.",
        };
      }

      const rows = peers
        .map((peer) => {
          const caps = peer.capabilities.length > 0 ? ` [${peer.capabilities.join(", ")}]` : "";
          return `- ${peer.id}${peer.label ? ` (${peer.label})` : ""}${caps} expires ${formatExpiry(peer.expiresAt)}`;
        })
        .join("\n");

      return {
        title: `Mesh Peers (${peers.length})`,
        metadata: { count: peers.length },
        output: rows,
      };
    },
  }),
};

const MeshReservationParams = z.object({
  action: z.enum(["reserve", "release", "list", "overlay"]).default("list").describe("Reservation operation"),
  sessionId: z.string().optional().describe("Owner session id (defaults to current session)"),
  paths: z.array(z.string()).optional().describe("Paths to reserve/release"),
  reason: z.string().optional().describe("Optional reservation reason"),
  ttlMinutes: z.number().int().min(1).max(240).default(30).describe("Reservation TTL in minutes"),
  hardBlock: z.boolean().default(true).describe("Whether reservations hard-block other sessions"),
  releaseAll: z.boolean().default(false).describe("Release all reservations for the target session"),
});

export const meshReservationTool: ToolDefinition = {
  id: "zee:mesh-reservation",
  category: "domain",
  init: async () => ({
    description: `Mesh file reservation control with hard conflict blocking in edit/write tools.`,
    parameters: MeshReservationParams,
    execute: async (args, ctx): Promise<ToolExecutionResult> => {
      const ownerSessionId = args.sessionId?.trim() || ctx.sessionId;
      ctx.metadata({ title: `Mesh Reservation: ${args.action}` });

      if (args.action === "reserve") {
        if (!args.paths || args.paths.length === 0) {
          return {
            title: "Mesh Reservation Failed",
            metadata: { action: args.action, error: "missing_paths" },
            output: "paths is required when action=reserve",
          };
        }
        const result = await reserveMeshPaths({
          sessionId: ownerSessionId,
          paths: args.paths,
          agent: ctx.agent,
          reason: args.reason,
          ttlMs: args.ttlMinutes * 60 * 1000,
          hardBlock: args.hardBlock,
        });

        if (!result.ok) {
          const lines = result.conflicts.map(
            (conflict) =>
              `- ${conflict.requestedPath} conflicts with ${conflict.reservedPath} (session ${conflict.ownerSessionId}, expires ${formatExpiry(conflict.expiresAt)})`,
          );
          return {
            title: "Mesh Reservation Conflict",
            metadata: { action: args.action, conflicts: result.conflicts.length },
            output: lines.join("\n"),
          };
        }

        const lines = result.reserved.map(
          (reservation) =>
            `- ${reservation.path} (owner ${reservation.ownerSessionId}, expires ${formatExpiry(reservation.expiresAt)})`,
        );
        return {
          title: `Reserved ${result.reserved.length} Path(s)`,
          metadata: { action: args.action, count: result.reserved.length, sessionId: ownerSessionId },
          output: lines.join("\n"),
        };
      }

      if (args.action === "release") {
        const released = await releaseMeshPaths({
          sessionId: ownerSessionId,
          paths: args.paths,
          releaseAll: args.releaseAll,
        });
        const rows = released.map((reservation) => `- ${reservation.path}`);
        return {
          title: `Released ${released.length} Reservation(s)`,
          metadata: { action: args.action, count: released.length, sessionId: ownerSessionId },
          output: rows.length > 0 ? rows.join("\n") : "No reservations released.",
        };
      }

      if (args.action === "overlay") {
        const [peers, reservations] = await Promise.all([listMeshPeers(), listMeshReservations()]);
        const peerLines = peers.map((peer) => `- ${peer.id} expires ${formatExpiry(peer.expiresAt)}`);
        const reservationLines = reservations.map(
          (reservation) =>
            `- ${reservation.path} -> ${reservation.ownerSessionId} (expires ${formatExpiry(reservation.expiresAt)})`,
        );
        return {
          title: "Mesh Overlay",
          metadata: { peerCount: peers.length, reservationCount: reservations.length },
          output: [
            `Peers (${peers.length})`,
            peerLines.length > 0 ? peerLines.join("\n") : "none",
            "",
            `Reservations (${reservations.length})`,
            reservationLines.length > 0 ? reservationLines.join("\n") : "none",
          ].join("\n"),
        };
      }

      const reservations = await listMeshReservations({
        sessionId: args.sessionId ? ownerSessionId : undefined,
      });
      const rows = reservations.map(
        (reservation) =>
          `- ${reservation.path} -> ${reservation.ownerSessionId}${reservation.ownerAgent ? ` (${reservation.ownerAgent})` : ""} expires ${formatExpiry(reservation.expiresAt)}`,
      );
      return {
        title: `Mesh Reservations (${reservations.length})`,
        metadata: { count: reservations.length, filteredSessionId: args.sessionId ? ownerSessionId : undefined },
        output: rows.length > 0 ? rows.join("\n") : "No active reservations.",
      };
    },
  }),
};

export const MESH_TOOLS = [meshPeerTool, meshReservationTool];
