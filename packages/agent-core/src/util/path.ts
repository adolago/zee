export function getFilename(path: string | undefined) {
  if (!path) return ""
  let end = path.length
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) {
    end--
  }
  if (end === 0) return ""
  const lastSlashIndex = Math.max(path.lastIndexOf("/", end - 1), path.lastIndexOf("\\", end - 1))
  if (lastSlashIndex === -1) return path.slice(0, end)
  return path.slice(lastSlashIndex + 1, end)
}

export function getDirectory(path: string | undefined) {
  if (!path) return ""
  const trimmed = path.replace(/[\/\\]+$/, "")
  const lastSlashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  if (lastSlashIndex === -1) return "/"
  return trimmed.slice(0, lastSlashIndex).replace(/\\/g, "/") + "/"
}

export function getFileExtension(path: string | undefined) {
  if (!path) return ""
  const lastDotIndex = path.lastIndexOf(".")
  if (lastDotIndex === -1) return path
  return path.slice(lastDotIndex + 1)
}

export function getFilenameTruncated(path: string | undefined, maxLength: number = 20) {
  const filename = getFilename(path)
  if (filename.length <= maxLength) return filename
  const lastDot = filename.lastIndexOf(".")
  const ext = lastDot <= 0 ? "" : filename.slice(lastDot)
  const available = maxLength - ext.length - 1 // -1 for ellipsis
  if (available <= 0) return filename.slice(0, maxLength - 1) + "…"
  return filename.slice(0, available) + "…" + ext
}

export function truncateMiddle(text: string, maxLength: number = 20) {
  if (text.length <= maxLength) return text
  const available = maxLength - 1 // -1 for ellipsis
  const start = Math.ceil(available / 2)
  const end = Math.floor(available / 2)
  return text.slice(0, start) + "…" + text.slice(-end)
}
