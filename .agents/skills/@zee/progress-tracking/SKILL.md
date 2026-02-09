---
name: progress-tracking
description: Track learning progress, identify gaps, and adapt curriculum
version: 1.0.0
author: Artur
tags: [learning, progress, tracking, johny]
triggers:
  - progress
  - status
  - what should I learn
  - review
  - dashboard
---

# Progress Tracking

Monitor learning journey with data-driven insights.

## Mastery-Based Progression

### Mastery Levels
```
Level 0: Never seen
Level 1: Introduced (< 50% accuracy)
Level 2: Developing (50-70% accuracy)
Level 3: Proficient (70-90% accuracy)
Level 4: Mastered (> 90% accuracy, retained over time)
```

### Advancement Criteria
To advance from Level N to N+1:
- Accuracy threshold met for 3+ sessions
- Demonstrated retention after 7 days
- Can apply to novel problems

## Learning Metrics

### Daily Metrics
- Time spent practicing
- Problems attempted / solved
- New concepts introduced
- Items reviewed via spaced repetition

### Weekly Metrics
- Topics progressed
- Mastery levels gained
- Retention rate (% of reviewed items correct)
- Streak days

### Long-term Metrics
- Overall curriculum completion %
- Average time to mastery per topic
- Retention curve
- Skill tree coverage

## Gap Analysis

Identify what's blocking progress:

```typescript
async function findGaps(targetTopic: string) {
  const prereqs = await getPrerequisites(targetTopic);
  const mastery = await getMasteryLevels(prereqs);

  return prereqs.filter(p => mastery[p] < 3);  // Not proficient
}
```

## Curriculum Adaptation

### When Student Is Struggling
- Review prerequisites
- More scaffolded practice
- Simpler examples first
- More spaced repetition

### When Student Is Breezing
- Skip ahead
- Introduce harder variants
- Reduce scaffolding
- Challenge problems

## Memory Schema

### Student Profile
```typescript
await memory.store({
  namespace: "johny/profile",
  key: "current",
  value: {
    currentTopics: ["calculus/integration"],
    overallProgress: 0.35,  // 35% of curriculum
    streakDays: 12,
    totalPracticeHours: 47,
    strongAreas: ["algebra", "logic"],
    weakAreas: ["geometry", "probability"],
    learningStyle: "visual",
    preferredSessionLength: 25  // minutes
  }
});
```

### Topic Progress
```typescript
await memory.store({
  namespace: "johny/topics",
  key: topic,
  value: {
    topic,
    masteryLevel: 3,
    accuracy7day: 0.82,
    accuracy30day: 0.78,
    lastPracticed: new Date(),
    nextReview: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    problemsSolved: 45,
    averageTimePerProblem: 120,  // seconds
    notes: "Struggles with integration by parts"
  }
});
```

## Progress Reports

### Daily Summary
- What was practiced
- Accuracy by topic
- Items added to review queue
- Recommendations for tomorrow

### Weekly Review
- Topics progressed
- New masteries achieved
- Gaps identified
- Curriculum adjustments

### Monthly Review
- Overall trajectory
- Comparison to goals
- Major achievements
- Strategic recommendations
