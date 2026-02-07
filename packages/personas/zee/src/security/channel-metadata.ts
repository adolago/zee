import { wrapExternalContent } from "./external-content.js";

export function buildUntrustedChannelMetadata(params: {
  providerLabel: string;
  groupId?: string;
  groupChannel?: string;
  groupSpace?: string;
  subject?: string;
  members?: string;
}): string | null {
  const lines: string[] = [`Provider: ${params.providerLabel}`];
  if (params.groupId?.trim()) {
    lines.push(`Group ID: ${params.groupId.trim()}`);
  }
  if (params.groupChannel?.trim()) {
    lines.push(`Group Channel: ${params.groupChannel.trim()}`);
  }
  if (params.groupSpace?.trim()) {
    lines.push(`Group Space: ${params.groupSpace.trim()}`);
  }
  if (params.subject?.trim()) {
    lines.push(`Group Subject: ${params.subject.trim()}`);
  }
  if (params.members?.trim()) {
    lines.push(`Group Members: ${params.members.trim()}`);
  }

  if (lines.length === 0) return null;

  return wrapExternalContent(lines.join("\n"), {
    source: "channel_metadata",
    includeWarning: false,
  });
}

