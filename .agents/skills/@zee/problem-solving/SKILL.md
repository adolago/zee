---
name: problem-solving
description: Structured problem-solving with scaffolding for math and informatics
version: 1.0.0
author: Artur
tags: [learning, problem-solving, math, johny]
triggers:
  - solve
  - problem
  - exercise
  - challenge
  - stuck
---

# Problem Solving

Guide through problems with appropriate scaffolding, developing independence.

## Problem-Solving Framework

### Polya's Four Steps
1. **Understand**: What is given? What is asked?
2. **Plan**: What approach? What tools needed?
3. **Execute**: Carry out the plan carefully
4. **Reflect**: Is answer reasonable? What did I learn?

## Scaffolding Levels

### Level 1: Heavy Support
- Break problem into small steps
- Provide hints at each step
- Model the thinking process

### Level 2: Moderate Support
- Outline the approach
- Let student fill in details
- Intervene only when stuck

### Level 3: Light Support
- Only confirm approach is valid
- Student does all work
- Review at end

### Level 4: Independence
- Student works alone
- Only helps if explicitly asked
- Focus on meta-cognitive skills

## Hint Progression

When student is stuck:

1. **Metacognitive**: "What have you tried? What do you know?"
2. **Strategic**: "Have you seen a similar problem?"
3. **Tactical**: "Try looking at [specific aspect]"
4. **Direct**: "The next step is..."

Never jump to direct hints. Work down the ladder.

## Problem Categories

### Math Problems
- Computational (apply algorithms)
- Conceptual (apply understanding)
- Proof (logical reasoning)
- Modeling (translate real-world)

### Informatics Problems
- Implementation (code it correctly)
- Algorithm design (find efficient approach)
- Debugging (find and fix errors)
- Optimization (improve existing solution)

## Error Response

When student makes error:
1. Don't immediately correct
2. Ask "Are you sure about that step?"
3. If they can't find error: point to location, not solution
4. If still stuck: explain the error type
5. Have them redo with understanding

## Memory Integration

Track problem-solving patterns:
```typescript
await memory.store({
  namespace: "johny/problems",
  key: `${topic}/${problemId}`,
  value: {
    problem: "...",
    topic,
    difficulty: "medium",
    attemptCount: 2,
    solvedIndependently: false,
    scaffoldingUsed: "level-2",
    timeToSolve: 480,  // seconds
    hintsUsed: ["strategic"],
    errorsEncountered: ["sign-error", "index-off-by-one"],
    reflection: "Need more practice with boundary conditions"
  }
});
```

## Progression Tracking

Move to harder problems when:
- 3 consecutive problems solved at current level
- Less than 1 hint needed on average
- Time under threshold for problem type
