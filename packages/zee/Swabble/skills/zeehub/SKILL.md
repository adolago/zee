---
name: zeehub
description: Use the ZeeHub CLI to search, install, update, and publish agent skills from zeehub.com. Use when you need to fetch new skills on the fly, sync installed skills to latest or a specific version, or publish new/updated skill folders with the npm-installed zeehub CLI.
metadata: {"zee":{"requires":{"bins":["zeehub"]},"install":[{"id":"node","kind":"node","package":"zeehub","bins":["zeehub"],"label":"Install ZeeHub CLI (npm)"}]}}
---

# ZeeHub CLI

Install
```bash
npm i -g zeehub
```

Auth (publish)
```bash
zeehub login
zeehub whoami
```

Search
```bash
zeehub search "postgres backups"
```

Install
```bash
zeehub install my-skill
zeehub install my-skill --version 1.2.3
```

Update (hash-based match + upgrade)
```bash
zeehub update my-skill
zeehub update my-skill --version 1.2.3
zeehub update --all
zeehub update my-skill --force
zeehub update --all --no-input --force
```

List
```bash
zeehub list
```

Publish
```bash
zeehub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs"
```

Notes
- Default registry: https://zeehub.com (override with ZEEHUB_REGISTRY or --registry)
- Default workdir: cwd (falls back to Zee workspace); install dir: ./skills (override with --workdir / --dir / ZEEHUB_WORKDIR)
- Update command hashes local files, resolves matching version, and upgrades to latest unless --version is set
