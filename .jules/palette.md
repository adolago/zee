## 2024-05-21 - Accessible Custom Input Groups
**Learning:** Custom selection components (like `QuestionPrompt`) often use buttons for options but lack semantic grouping and state information, making them inaccessible to screen readers.
**Action:** When building custom radio or checkbox groups:
1. Wrap options in a container with `role="radiogroup"` or `role="group"`.
2. Label the group using `aria-labelledby` pointing to the question/title ID (generate unique ID with `createUniqueId`).
3. Use `role="radio"` or `role="checkbox"` on the option buttons.
4. Use `aria-checked` to indicate selection state.
