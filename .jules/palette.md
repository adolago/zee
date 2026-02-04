## 2026-02-04 - List Search Accessibility Pattern
**Learning:** Many list components use a search input with a placeholder but no explicit label. Duplicating the placeholder text as an `aria-label` is a pragmatic way to ensure accessibility without breaking existing i18n patterns or requiring widespread code changes.
**Action:** When creating reusable components with inputs that might lack visible labels, allow `aria-label` to default to `placeholder` if not explicitly provided, but prefer explicit labels where possible.
