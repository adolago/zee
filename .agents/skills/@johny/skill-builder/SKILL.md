---
name: "Skill Builder"
description: "Create new Skills with proper YAML frontmatter and progressive disclosure structure. Use when building custom skills for specific workflows, generating skill templates, or understanding the Skills specification."
---

# Skill Builder

Creates production-ready Skills with proper YAML frontmatter and progressive disclosure architecture.

## YAML Frontmatter (Required)

Every SKILL.md **must** start with:

```yaml
---
name: "Skill Name"                    # Required, max 64 chars
description: "What this skill does    # Required, max 1024 chars
and when to use it."                  # Include BOTH what & when
---
```

**Only `name` and `description` are used.** Additional fields (version, author, tags) are ignored by the loader but acceptable for your own tracking.

### Writing Good Descriptions

- Front-load keywords that trigger matching
- Include both **what** it does and **when** to invoke it
- Be specific about technologies and use cases

```yaml
# Good
description: "Generate OpenAPI 3.0 docs from Express.js routes. Use when creating API docs, documenting endpoints, or building API specs."

# Bad
description: "A documentation tool."
```

## Directory Structure

### Skill Locations

**Personal** (all projects): `~/.claude/skills/[skill-name]/SKILL.md`
**Project** (team-shared): `<project-root>/.claude/skills/[skill-name]/SKILL.md`

Skills MUST be directly under the skills directory -- no nested subdirectories.

### Minimal
```
my-skill/
  SKILL.md              # Required
```

### Full-Featured
```
my-skill/
  SKILL.md              # Required: main instructions
  scripts/              # Executable scripts Claude can run
    setup.sh
    generate.py
  resources/            # Templates, examples, schemas
    templates/
    examples/
  docs/                 # Advanced docs (loaded on demand)
    ADVANCED.md
```

## Progressive Disclosure (3 Levels)

### Level 1: Metadata (always loaded)
The `name` + `description` from frontmatter. Loaded into system prompt for ALL skills at startup. Keep descriptions concise -- 100 skills = ~6KB context.

### Level 2: SKILL.md body (loaded when skill triggers)
Main instructions. Target 2-5KB. This is where core procedures live.

### Level 3: Referenced files (loaded on demand)
Docs, templates, schemas. Claude navigates to these only when needed. Use markdown links:
```markdown
See [Advanced Configuration](docs/ADVANCED.md) for complex scenarios.
```

**Principle**: Keep SKILL.md lean. Move reference material to separate files.

## SKILL.md Content Template

```markdown
---
name: "My Skill"
description: "What it does. When to use it."
---

# My Skill

## What This Skill Does
[2-3 sentences]

## Prerequisites
- Requirement 1
- Requirement 2

## Quick Start
```bash
# Simplest use case
command --option value
```

## Step-by-Step Guide

### Step 1: Setup
[Instructions]

### Step 2: Usage
[Instructions]

### Step 3: Verify
[Instructions]

## Troubleshooting
- **Issue**: Problem description
  - **Solution**: Fix steps
```

## Validation Checklist

Before publishing:

- [ ] Frontmatter has `name` (max 64 chars) and `description` (max 1024 chars)
- [ ] Description includes "what" and "when"
- [ ] Directory is directly under `~/.claude/skills/` or `.claude/skills/`
- [ ] SKILL.md body is 2-5KB (not bloated)
- [ ] Advanced content is in separate docs/ files
- [ ] Examples are concrete and runnable
- [ ] Skill appears in skill list after creation
