## 2026-02-05 - [Bun/JSC String Replacement Optimization]
**Learning:** In Bun/JSC environments, checking for existence of a substring using `indexOf` before calling `replace` is significantly faster (up to 25x in benchmarks) when the substring is rarely present (e.g., sanitizing null bytes from paths).
**Action:** For hot paths involving string sanitization where the target character is rare, always guard `.replace()` with an `.indexOf() !== -1` check.
