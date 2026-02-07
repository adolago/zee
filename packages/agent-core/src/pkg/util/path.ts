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
  const lastSlash = path.lastIndexOf("/")
  if (lastSlash === -1) return "/"
  return path.slice(0, lastSlash) + "/"
}

export function getFileExtension(path: string | undefined) {
  if (!path) return ""
  const lastDotIndex = path.lastIndexOf(".")
  if (lastDotIndex === -1) return path
  return path.slice(lastDotIndex + 1)
}
