## 2025-05-24 - Windows Path Traversal in relative()
**Vulnerability:** `path.relative()` on Windows returns an absolute path when crossing drives (e.g., `C:\` to `D:\`), which does not start with `..`. This bypasses checks like `!relative(parent, child).startsWith("..")`.
**Learning:** `path.relative` is not sufficient for containment checks on Windows without also checking `path.isAbsolute()`.
**Prevention:** Always check `!isAbsolute(relative_path)` in addition to `!startsWith("..")` when verifying path containment.
