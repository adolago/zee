import { randomUUID } from "node:crypto";

import { archiveSessionTranscripts } from "./session-utils.fs.js";

export type SessionLifecycleTrigger = "new" | "reset";

export type SessionLifecycleEntry = {
  sessionId: string;
  sessionFile?: string;
  updatedAt?: number;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  ttsAuto?: string;
  modelOverride?: string;
  providerOverride?: string;
};

export function rotateSessionOnTrigger(params: {
  trigger: SessionLifecycleTrigger;
  entry?: SessionLifecycleEntry;
  storePath?: string;
  agentId?: string;
  now?: number;
  generateSessionId?: () => string;
}): {
  nextEntry: SessionLifecycleEntry;
  archived: string[];
} {
  const previous = params.entry;
  const nextEntry: SessionLifecycleEntry = {
    sessionId: (params.generateSessionId ?? randomUUID)(),
    updatedAt: params.now ?? Date.now(),
    thinkingLevel: previous?.thinkingLevel,
    verboseLevel: previous?.verboseLevel,
    reasoningLevel: previous?.reasoningLevel,
    ttsAuto: previous?.ttsAuto,
    modelOverride: previous?.modelOverride,
    providerOverride: previous?.providerOverride,
  };

  const archived = previous?.sessionId
    ? archiveSessionTranscripts({
        sessionId: previous.sessionId,
        storePath: params.storePath,
        sessionFile: previous.sessionFile,
        agentId: params.agentId,
        // Upstream behavior uses a reset-suffixed archive for both /new and /reset session rotation.
        reason: "reset",
      })
    : [];

  return { nextEntry, archived };
}
