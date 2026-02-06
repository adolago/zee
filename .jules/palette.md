## 2026-02-06 - Custom Radio/Checkbox Groups
**Learning:** Custom buttons used as radio/checkbox options lack semantic meaning for screen readers.
**Action:** Use `role="radiogroup"`/`role="group"` on container and `role="radio"`/`role="checkbox"` with `aria-checked` on buttons. Link label with `aria-labelledby`.
