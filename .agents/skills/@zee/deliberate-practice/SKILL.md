---
name: deliberate-practice
description: Structured practice sessions with immediate feedback for skill acquisition
version: 1.0.0
author: Artur
tags: [learning, practice, skills, johny]
triggers:
  - practice
  - drill
  - exercise
  - train
  - learn by doing
---

# Deliberate Practice

Facilitate focused, goal-oriented practice sessions based on Anders Ericsson's deliberate practice principles.

## Core Principles

1. **Specific Goals**: Each session targets a specific sub-skill
2. **Full Attention**: Concentrated effort, no distractions
3. **Immediate Feedback**: Know if you're right/wrong instantly
4. **Stretch Zone**: Just beyond current ability (not too easy, not impossible)
5. **Repetition with Refinement**: Repeat until mastery, then move on

## Practice Session Structure

### 1. Warm-up (5 min)
- Review prerequisites
- Recall relevant concepts
- Set specific goal for session

### 2. Focused Practice (20-25 min)
- Work on problems at edge of ability
- Get immediate feedback on each attempt
- Identify specific errors and why they occurred

### 3. Cool-down (5 min)
- Summarize what was learned
- Note persistent difficulties
- Queue items for spaced repetition

## Difficulty Calibration

```
Too Easy    │ Optimal Zone │ Too Hard
────────────┼──────────────┼──────────
< 70% right │ 70-85% right │ > 85% wrong
Boring      │ Challenging  │ Frustrating
No growth   │ Maximum      │ No growth
            │ learning     │
```

## Feedback Patterns

### Immediate Correction
When student makes error:
1. Show correct answer
2. Explain why it's correct
3. Have them redo the problem
4. Queue similar problem for later

### Error Analysis
Track error types:
- Conceptual (misunderstanding)
- Procedural (wrong steps)
- Careless (attention lapse)
- Knowledge gap (missing prerequisite)

## Memory Integration

Store practice data:
```typescript
await memory.store({
  namespace: "johny/practice",
  key: `session/${date}/${topic}`,
  value: {
    topic,
    problemsAttempted: 15,
    accuracy: 0.73,
    timeSpent: 25,
    errorsBy Type: { conceptual: 2, procedural: 2 },
    itemsForReview: ["integration-by-parts", "trig-substitution"]
  }
});
```

## Spaced Repetition Queue

Items needing review are scheduled based on performance:
- First error: Review in 1 day
- Second error: Review in 4 hours
- Correct after error: Review in 3 days
- Consistently correct: Review in 7 days, then 14, 30...
