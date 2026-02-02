## 2026-02-02 - String Sanitization Optimization
**Learning:** In Bun (JavaScriptCore), `string.includes()` can be significantly slower than `string.indexOf() !== -1` for checking character existence before replacement. `replace(/\0/g, "")` is optimized but still slower than `indexOf`.
**Action:** Use `indexOf() !== -1` as a guard clause for string replacements in hot paths.
