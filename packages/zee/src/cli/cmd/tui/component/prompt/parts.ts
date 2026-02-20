import type { PromptInfo, PromptPart } from "./types"

type PromptPartPlaceholder = {
  start: number
  end: number
  value: string
}

export type PromptPartIssueReason =
  | "missing_placeholder_source"
  | "placeholder_out_of_bounds"
  | "placeholder_mismatch"
  | "placeholder_not_found"
  | "placeholder_collision"

export type PromptPartIssue = {
  index: number
  type: PromptPart["type"]
  reason: PromptPartIssueReason
  placeholder: string
  start?: number
  end?: number
  remappedStart?: number
  remappedEnd?: number
}

export type PromptPartSanitizationResult = {
  parts: PromptInfo["parts"]
  dropped: PromptPartIssue[]
  remapped: PromptPartIssue[]
}

export function getPromptPartPlaceholder(part: PromptPart): PromptPartPlaceholder | null {
  if (part.type === "text") {
    if (!part.source?.text) return null
    return {
      start: part.source.text.start,
      end: part.source.text.end,
      value: part.source.text.value,
    }
  }

  if (part.type === "file") {
    if (!part.source?.text) return null
    return {
      start: part.source.text.start,
      end: part.source.text.end,
      value: part.source.text.value,
    }
  }

  if (part.type === "agent") {
    if (!part.source) return null
    return {
      start: part.source.start,
      end: part.source.end,
      value: part.source.value,
    }
  }

  return null
}

export function withPromptPartPlaceholderRange(part: PromptPart, start: number, end: number): PromptPart {
  if (part.type === "text" && part.source?.text) {
    return {
      ...part,
      source: {
        ...part.source,
        text: {
          ...part.source.text,
          start,
          end,
        },
      },
    }
  }

  if (part.type === "file" && part.source?.text) {
    return {
      ...part,
      source: {
        ...part.source,
        text: {
          ...part.source.text,
          start,
          end,
        },
      },
    }
  }

  if (part.type === "agent" && part.source) {
    return {
      ...part,
      source: {
        ...part.source,
        start,
        end,
      },
    }
  }

  return part
}

function placeholderPreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim()
  if (compact.length <= 80) return compact
  return compact.slice(0, 77) + "..."
}

function rangeKey(start: number, end: number): string {
  return `${start}:${end}`
}

function inBounds(input: string, placeholder: PromptPartPlaceholder): boolean {
  return (
    Number.isInteger(placeholder.start) &&
    Number.isInteger(placeholder.end) &&
    placeholder.start >= 0 &&
    placeholder.end >= placeholder.start &&
    placeholder.end <= input.length
  )
}

function findOccurrences(input: string, needle: string): Array<{ start: number; end: number }> {
  if (!needle) return []
  const occurrences: Array<{ start: number; end: number }> = []
  let from = 0
  while (from <= input.length - needle.length) {
    const idx = input.indexOf(needle, from)
    if (idx === -1) break
    occurrences.push({ start: idx, end: idx + needle.length })
    from = idx + Math.max(needle.length, 1)
  }
  return occurrences
}

type Occurrence = { start: number; end: number }

type PartState =
  | {
      kind: "drop"
      issue: PromptPartIssue
      part: PromptPart
    }
  | {
      kind: "keep"
      part: PromptPart
      placeholder: PromptPartPlaceholder
      index: number
    }
  | {
      kind: "remap"
      part: PromptPart
      placeholder: PromptPartPlaceholder
      index: number
      issue: PromptPartIssue
    }

type RemapState = Extract<PartState, { kind: "remap" }>

function assignRemappedOccurrences(
  input: string,
  states: RemapState[],
  reserved: Set<string>,
  occurrencesByPlaceholder: Map<string, Occurrence[]>,
): Map<number, Occurrence> {
  const assignments = new Map<number, Occurrence>()
  const claimedRanges = new Set<string>(reserved)
  const groups = new Map<string, RemapState[]>()

  for (const state of states) {
    const group = groups.get(state.placeholder.value)
    if (group) {
      group.push(state)
      continue
    }
    groups.set(state.placeholder.value, [state])
  }

  for (const [placeholderValue, group] of groups) {
    let occurrences = occurrencesByPlaceholder.get(placeholderValue)
    if (!occurrences) {
      occurrences = findOccurrences(input, placeholderValue)
      occurrencesByPlaceholder.set(placeholderValue, occurrences)
    }

    const available = occurrences.filter((occurrence) => !claimedRanges.has(rangeKey(occurrence.start, occurrence.end)))
    if (available.length === 0) continue

    const candidates = [] as Array<{
      state: RemapState
      occurrence: Occurrence
      distanceStart: number
      distanceEnd: number
    }>

    for (const state of group) {
      for (const occurrence of available) {
        candidates.push({
          state,
          occurrence,
          distanceStart: Math.abs(occurrence.start - state.placeholder.start),
          distanceEnd: Math.abs(occurrence.end - state.placeholder.end),
        })
      }
    }

    candidates.sort((a, b) => {
      if (a.distanceStart !== b.distanceStart) return a.distanceStart - b.distanceStart
      if (a.distanceEnd !== b.distanceEnd) return a.distanceEnd - b.distanceEnd
      if (a.occurrence.start !== b.occurrence.start) return a.occurrence.start - b.occurrence.start
      if (a.occurrence.end !== b.occurrence.end) return a.occurrence.end - b.occurrence.end
      return a.state.index - b.state.index
    })

    const assignedStates = new Set<number>()

    for (const candidate of candidates) {
      const stateIndex = candidate.state.index
      const occurrenceKey = rangeKey(candidate.occurrence.start, candidate.occurrence.end)
      if (assignedStates.has(stateIndex) || claimedRanges.has(occurrenceKey)) continue

      assignments.set(stateIndex, candidate.occurrence)
      assignedStates.add(stateIndex)
      claimedRanges.add(occurrenceKey)
    }
  }

  return assignments
}

export function sanitizePromptPartsAgainstInput(input: string, parts: PromptInfo["parts"]): PromptPartSanitizationResult {
  const dropped: PromptPartIssue[] = []
  const remapped: PromptPartIssue[] = []
  const states: PartState[] = []
  const reserved = new Set<string>()

  for (const [index, part] of parts.entries()) {
    const placeholder = getPromptPartPlaceholder(part)
    if (!placeholder || !placeholder.value) {
      states.push({
        kind: "drop",
        part,
        issue: {
          index,
          type: part.type,
          reason: "missing_placeholder_source",
          placeholder: placeholderPreview(placeholder?.value ?? ""),
        },
      })
      continue
    }

    if (!inBounds(input, placeholder)) {
      states.push({
        kind: "remap",
        part,
        placeholder,
        index,
        issue: {
          index,
          type: part.type,
          reason: "placeholder_out_of_bounds",
          placeholder: placeholderPreview(placeholder.value),
          start: placeholder.start,
          end: placeholder.end,
        },
      })
      continue
    }

    const visible = input.slice(placeholder.start, placeholder.end)
    if (visible !== placeholder.value) {
      states.push({
        kind: "remap",
        part,
        placeholder,
        index,
        issue: {
          index,
          type: part.type,
          reason: "placeholder_mismatch",
          placeholder: placeholderPreview(placeholder.value),
          start: placeholder.start,
          end: placeholder.end,
        },
      })
      continue
    }

    const key = rangeKey(placeholder.start, placeholder.end)
    if (reserved.has(key)) {
      states.push({
        kind: "remap",
        part,
        placeholder,
        index,
        issue: {
          index,
          type: part.type,
          reason: "placeholder_collision",
          placeholder: placeholderPreview(placeholder.value),
          start: placeholder.start,
          end: placeholder.end,
        },
      })
      continue
    }

    reserved.add(key)
    states.push({ kind: "keep", part, placeholder, index })
  }

  const occurrencesByPlaceholder = new Map<string, Array<{ start: number; end: number }>>()
  const sanitizedParts: PromptInfo["parts"] = []
  const remapAssignments = assignRemappedOccurrences(
    input,
    states.filter((state): state is RemapState => state.kind === "remap"),
    reserved,
    occurrencesByPlaceholder,
  )

  for (const state of states) {
    if (state.kind === "keep") {
      sanitizedParts.push(withPromptPartPlaceholderRange(state.part, state.placeholder.start, state.placeholder.end))
      continue
    }

    if (state.kind === "drop") {
      dropped.push(state.issue)
      continue
    }

    const next = remapAssignments.get(state.index)
    if (!next) {
      dropped.push({
        ...state.issue,
        reason: "placeholder_not_found",
      })
      continue
    }

    reserved.add(rangeKey(next.start, next.end))
    sanitizedParts.push(withPromptPartPlaceholderRange(state.part, next.start, next.end))
    remapped.push({
      ...state.issue,
      remappedStart: next.start,
      remappedEnd: next.end,
    })
  }

  return { parts: sanitizedParts, dropped, remapped }
}

export function expandPromptTextPartsFromSanitized(input: string, parts: PromptInfo["parts"]): string {
  const sortedTextParts = parts
    .filter((part): part is Extract<PromptPart, { type: "text" }> => part.type === "text" && Boolean(part.source?.text))
    .sort((a, b) => b.source!.text.start - a.source!.text.start)

  let expanded = input
  for (const part of sortedTextParts) {
    const start = part.source!.text.start
    const end = part.source!.text.end
    expanded = expanded.slice(0, start) + part.text + expanded.slice(end)
  }
  return expanded
}

export function expandPromptTextParts(
  input: string,
  parts: PromptInfo["parts"],
): PromptPartSanitizationResult & { text: string } {
  const sanitized = sanitizePromptPartsAgainstInput(input, parts)
  return {
    ...sanitized,
    text: expandPromptTextPartsFromSanitized(input, sanitized.parts),
  }
}

export function logPromptPartSanitization(context: string, result: Pick<PromptPartSanitizationResult, "dropped" | "remapped">) {
  if (result.dropped.length === 0 && result.remapped.length === 0) return
  console.warn("[prompt.parts.sanitize]", {
    context,
    dropped: result.dropped,
    remapped: result.remapped,
  })
}
