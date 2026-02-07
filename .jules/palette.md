## 2026-02-07 - SVG Accessibility Gaps
**Learning:** Custom SVG components (like `ProgressCircle` and `Spinner`) often lack semantic roles (`role="progressbar"`, `role="status"`), making them invisible to screen readers.
**Action:** Audit all custom SVG components and ensure they have appropriate ARIA roles and attributes (`aria-valuenow`, `aria-valuemin`, `aria-valuemax`).
