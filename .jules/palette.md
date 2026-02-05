## 2024-10-24 - Accessible Option Lists
**Learning:** Interactive lists of options (like questions) implemented as divs and buttons often lack semantic context.
**Action:** When creating selection lists, always use `role="radiogroup"` or `role="group"` (for checkboxes) with `aria-labelledby`, and ensure individual items have `role="radio"` or `role="checkbox"` with explicit `aria-checked` states.
