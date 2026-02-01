---
name: concept-exploration
description: Deep understanding through Socratic questioning and concept mapping
version: 1.0.0
author: Artur
tags: [learning, concepts, understanding, johny]
triggers:
  - explain
  - understand
  - why does
  - how does
  - concept
  - theory
---

# Concept Exploration

Build deep understanding through active inquiry, not passive reading.

## Learning Approach

Inspired by Math Academy and Feynman technique:

1. **Can you explain it simply?** If not, you don't understand it
2. **What are the prerequisites?** Map dependencies
3. **What are the edge cases?** Test understanding limits
4. **How does it connect?** Link to known concepts

## Exploration Methods

### Socratic Questioning
Ask probing questions:
- What do you mean by X?
- How did you arrive at that?
- What would be a counterexample?
- What assumptions are you making?
- What would change if...?

### Concept Mapping
```
         ┌─────────────┐
         │   Limits    │
         └──────┬──────┘
                │ enables
    ┌───────────┼───────────┐
    ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐
│Derivat.│ │Continu.│ │Integral│
└────────┘ └────────┘ └────────┘
```

### Prerequisite Check
Before teaching concept X:
1. List prerequisites A, B, C
2. Quick-check student knows A, B, C
3. If gap found, address prerequisite first
4. Only then proceed to X

## Mastery Criteria

A concept is "understood" when student can:
- [ ] Explain it in own words
- [ ] Give examples and non-examples
- [ ] Apply it to novel problems
- [ ] Identify when it's applicable
- [ ] Explain why it works (not just how)

## Memory Integration

Track concept mastery:
```typescript
await memory.store({
  namespace: "johny/concepts",
  key: topic,
  value: {
    topic,
    prerequisites: ["limits", "continuity"],
    masteryLevel: 0.85,  // 0-1 scale
    lastAssessed: new Date(),
    canExplain: true,
    canApply: true,
    canGeneralize: false,  // needs more work
    commonMisconceptions: ["confuses with..."]
  }
});
```

## Knowledge Graph

Build interconnected understanding:
```typescript
await memory.store({
  namespace: "johny/knowledge-graph",
  key: "edges",
  value: {
    edges: [
      { from: "derivative", to: "limit", relation: "defined-by" },
      { from: "integral", to: "antiderivative", relation: "inverse-of" },
      { from: "ftc", to: "derivative", relation: "connects" },
      { from: "ftc", to: "integral", relation: "connects" }
    ]
  }
});
```
