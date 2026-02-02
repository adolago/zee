---
name: Pair Programming
description: AI-assisted pair programming with driver/navigator roles, TDD mode, and real-time code review. Use when collaborating on implementation, doing test-driven development, or wanting structured code review during development.
version: 1.0.0
author: Artur
tags: [development, collaboration, testing, johny]
---

# Pair Programming

Collaborative development with structured roles and continuous quality feedback.

## Core Modes

### Driver Mode
You write code, AI navigates.

**You do**: Write code, implement solutions, make tactical decisions.
**AI does**: Strategic guidance, spot issues, suggest improvements, real-time review.

**Best for**: Learning new patterns, hands-on debugging, implementing with guardrails.

### Navigator Mode
AI writes code, you direct.

**You do**: High-level direction, review generated code, architectural decisions, business requirements.
**AI does**: Write implementation, handle syntax/boilerplate, execute refactoring.

**Best for**: Rapid prototyping, boilerplate generation, exploring solutions.

### TDD Mode
Test-driven development cycle.

**Workflow**: Write failing test -> Implement minimal code to pass -> Refactor -> Repeat.

**How to use**:
1. Describe the behavior you want
2. AI writes a failing test (RED)
3. You (or AI in navigator mode) write minimal code to pass (GREEN)
4. Refactor together while tests stay green (REFACTOR)

**Best for**: Building with confidence, catching regressions, designing clean interfaces.

## Starting a Session

Tell Johny what mode you want:

```
"Let's pair on the auth module in driver mode"
"Navigator mode -- build me a REST endpoint for /users"
"TDD session: shopping cart add/remove"
```

You can switch modes mid-session:

```
"Switch to navigator mode"
"Let me drive for a bit"
"Let's do TDD for this part"
```

## During a Session

### Review & Quality
- Ask for review at any point: "review this", "check for issues"
- AI flags: security concerns, performance issues, missing edge cases
- Request specific focus: "review for thread safety", "check error handling"

### Testing
- "Generate tests for this" -- AI creates unit tests for current code
- "What's the coverage?" -- AI identifies untested paths
- "Mock this dependency" -- AI generates mocks/stubs

### Refactoring
- "Refactor this to use X pattern"
- "Simplify this function"
- "Extract this into a module"

## Best Practices

1. **Set clear goals** before starting: "We're building X, it needs to do Y"
2. **Switch roles** when stuck -- fresh perspective helps
3. **Test after each change** -- do not let tests rot
4. **Commit at green** -- small, passing commits over big-bang merges
5. **Time-box sessions** -- 45-60 minutes with breaks

## When to Use Each Mode

| Situation | Mode |
|-----------|------|
| Learning a new codebase | Driver (you explore, AI guides) |
| Cranking out features fast | Navigator (AI writes, you steer) |
| Building critical/complex logic | TDD (tests enforce correctness) |
| Debugging | Driver (you poke around, AI spots patterns) |
| Code review | Any mode, ask "review this file/function" |
