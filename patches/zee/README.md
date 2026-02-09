# Zee Patches

This directory contains patch files documenting Zee's divergences from upstream. These patches are for documentation purposes: they help track what we changed and assist with merge conflict resolution.

## Divergence Categories

### 1. Naming/Branding (`001-naming.patch`)
- Rename CLI, paths, and docs from agent-core to zee
- Config paths: `~/.config/zee/`, `~/.local/state/zee/`

### 2. Agent System (`002-agents.patch`)
- Removed built-in agents (build, plan, general, explore)
- Single unified persona (zee)
- Custom themes

### 3. Provider Transforms (`003-providers.patch`)
- Custom provider configurations
- Antigravity integration
- OAuth token handling modifications

### 4. Persona Skills (`004-personas.patch`)
- `.claude/skills/` directory structure
- Skill loading from `~/.config/zee/skills/`
- Zee skills, memory, and orchestration

### 5. Memory Integration (`005-memory.patch`)
- Qdrant vector storage
- Conversation continuity
- Cross-persona memory sharing

### 6. TUI Customizations (`006-tui.patch`)
- Custom themes (zee.json plus legacy themes)
- Branch visualization in sidebar
- Breadcrumb navigation
- Persona UI affordances (legacy)

## Generating Patches

To generate a patch for a specific divergence:

```bash
# All changes since fork
git diff $(git merge-base HEAD upstream/dev)..HEAD > patches/zee/full-divergence.patch

# Specific file/directory
git diff $(git merge-base HEAD upstream/dev)..HEAD -- packages/zee-core/src/provider/ > patches/zee/003-providers.patch
```

## Applying Patches (for reference)

When merging upstream, if a conflict occurs in a known divergence area:

1. Check which patch category it falls into
2. Apply our changes on top of upstream's version
3. Resolve conflicts manually, preferring upstream structure with our customizations

```bash
# Preview patch application
git apply --check patches/zee/003-providers.patch

# Apply with 3-way merge (allows partial success)
git apply -3 patches/zee/003-providers.patch
```

## Version Mapping

| zee | Upstream Commit | Notes |
|------------|---------------------|-------|
| current | 7cba1ff79 | Merge base |

Update this table after each upstream sync.
