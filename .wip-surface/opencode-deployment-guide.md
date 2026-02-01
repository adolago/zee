# OpenCode + Agent-Core Deployment Guide

## Quick Start

### Docker Compose (Recommended)

```yaml
# docker-compose.yml
version: '3.8'

services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant-data:/qdrant/storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/healthz"]
      interval: 10s
      timeout: 5s
      retries: 5

  agent-core:
    image: adolago/agent-core:latest
    ports:
      - "3210:3210"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - QDRANT_URL=http://qdrant:6333
      - AGENT_CORE_ENABLE_SERVER_AUTH=${AGENT_CORE_ENABLE_SERVER_AUTH:-0}
      - AGENT_CORE_SERVER_PASSWORD=${AGENT_CORE_SERVER_PASSWORD}
    volumes:
      - agent-core-data:/data
      - ${HOME}/.config/agent-core:/config:ro
    depends_on:
      qdrant:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3210/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  opencode-adapter:
    image: adolago/opencode-adapter:latest
    ports:
      - "8080:8080"
    environment:
      - AGENT_CORE_URL=http://agent-core:3210
      - ADAPTER_PORT=8080
      - ADAPTER_AUTH_MODE=${ADAPTER_AUTH_MODE:-basic}
    depends_on:
      agent-core:
        condition: service_healthy

volumes:
  qdrant-data:
  agent-core-data:
```

Start the stack:
```bash
docker-compose up -d
```

## Installation Methods

### Method 1: Homebrew (macOS/Linux)

```bash
# Install both packages
brew install adolago/tap/agent-core
brew install adolago/tap/opencode-adapter

# Start agent-core daemon
agent-core daemon --hostname 127.0.0.1 --port 3210

# Configure opencode to use adapter
opencode config set adapter.url http://localhost:8080
```

### Method 2: NPM

```bash
# Install globally
npm install -g @adolago/agent-core @adolago/opencode-adapter

# Or with Bun
bun install -g @adolago/agent-core @adolago/opencode-adapter

# Start services
agent-core daemon &
opencode-adapter &
```

### Method 3: Systemd Services

```ini
# ~/.config/systemd/user/agent-core.service
[Unit]
Description=Agent-Core Daemon
After=network.target

[Service]
Type=simple
ExecStart=%h/.local/bin/agent-core daemon --hostname 127.0.0.1 --port 3210
Restart=always
RestartSec=5
Environment=ANTHROPIC_API_KEY=%h/.config/agent-core/.env

[Install]
WantedBy=default.target
```

```ini
# ~/.config/systemd/user/opencode-adapter.service
[Unit]
Description=OpenCode Adapter
After=agent-core.service
Requires=agent-core.service

[Service]
Type=simple
ExecStart=%h/.local/bin/opencode-adapter --port 8080 --agent-core-url http://127.0.0.1:3210
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:
```bash
systemctl --user daemon-reload
systemctl --user enable agent-core opencode-adapter
systemctl --user start agent-core opencode-adapter
```

## Configuration

### Agent-Core Configuration

```jsonc
// ~/.config/agent-core/agent-core.jsonc
{
  "$schema": "agent-core",
  "memory": {
    "qdrant": {
      "url": "http://localhost:6333",
      "collection": "personas_memory"
    },
    "embedding": {
      "profile": "google/gemini-embedding-001",
      "dimensions": 3072,
      "apiKey": "{env:GEMINI_API_KEY}"
    }
  },
  "provider": {
    "model": "anthropic/claude-3-5-sonnet",
    "fallback": "google/gemini-1.5-pro"
  },
  "agent": {
    "default": "zee"
  },
  "permission": {
    "*": "allow",
    "bash": "ask",
    "edit": "ask"
  }
}
```

### OpenCode Adapter Configuration

```yaml
# ~/.config/opencode-adapter/config.yaml
agentCore:
  url: http://localhost:3210
  timeout: 30000
  retries: 3

adapter:
  port: 8080
  host: 127.0.0.1
  
auth:
  mode: basic  # basic, token, or none
  username: opencode
  password: "{env:OPENCODE_ADAPTER_PASSWORD}"
  
sync:
  sessionInterval: 30000
  configInterval: 60000
  conflictStrategy: remote-wins

cache:
  enabled: true
  ttl: 300
  maxSize: 1000
```

### OpenCode Client Configuration

```jsonc
// ~/.config/opencode/config.json
{
  "adapter": {
    "enabled": true,
    "url": "http://localhost:8080",
    "auth": {
      "type": "basic",
      "username": "opencode",
      "password": "${OPENCODE_ADAPTER_PASSWORD}"
    }
  },
  "fallback": {
    "enabled": true,
    "nativeOnError": true
  }
}
```

## Kubernetes Deployment

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: opencode

---
# k8s/qdrant.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: qdrant
  namespace: opencode
spec:
  serviceName: qdrant
  replicas: 1
  selector:
    matchLabels:
      app: qdrant
  template:
    metadata:
      labels:
        app: qdrant
    spec:
      containers:
      - name: qdrant
        image: qdrant/qdrant:latest
        ports:
        - containerPort: 6333
        volumeMounts:
        - name: data
          mountPath: /qdrant/storage
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi

---
# k8s/agent-core.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-core
  namespace: opencode
spec:
  replicas: 2
  selector:
    matchLabels:
      app: agent-core
  template:
    metadata:
      labels:
        app: agent-core
    spec:
      containers:
      - name: agent-core
        image: adolago/agent-core:latest
        ports:
        - containerPort: 3210
        env:
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: agent-core-secrets
              key: anthropic-api-key
        - name: QDRANT_URL
          value: "http://qdrant:6333"
        - name: AGENT_CORE_ENABLE_SERVER_AUTH
          value: "1"
        - name: AGENT_CORE_SERVER_PASSWORD
          valueFrom:
            secretKeyRef:
              name: agent-core-secrets
              key: server-password
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"

---
# k8s/opencode-adapter.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opencode-adapter
  namespace: opencode
spec:
  replicas: 2
  selector:
    matchLabels:
      app: opencode-adapter
  template:
    metadata:
      labels:
        app: opencode-adapter
    spec:
      containers:
      - name: adapter
        image: adolago/opencode-adapter:latest
        ports:
        - containerPort: 8080
        env:
        - name: AGENT_CORE_URL
          value: "http://agent-core:3210"
        - name: ADAPTER_PORT
          value: "8080"
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

## Migration Scripts

### Session Migration

```bash
#!/bin/bash
# migrate-sessions.sh

OPENCODE_DATA_DIR="${HOME}/.config/opencode"
AGENT_CORE_URL="${AGENT_CORE_URL:-http://localhost:3210}"
AUTH_HEADER="${AUTH_HEADER:-}"

# Export sessions from OpenCode
opencode sessions export --format json > /tmp/opencode-sessions.json

# Transform and import to agent-core
node << 'EOF'
const fs = require('fs');
const sessions = JSON.parse(fs.readFileSync('/tmp/opencode-sessions.json'));

for (const session of sessions) {
  const transformed = {
    directory: session.working_directory,
    title: session.title,
    messages: session.messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
  };
  
  // Import to agent-core
  fetch(`${process.env.AGENT_CORE_URL}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.AUTH_HEADER ? { 'Authorization': process.env.AUTH_HEADER } : {}),
    },
    body: JSON.stringify(transformed),
  }).then(r => {
    if (!r.ok) console.error(`Failed to migrate session ${session.id}`);
    else console.log(`Migrated session ${session.id}`);
  });
}
EOF

echo "Migration complete!"
```

### Configuration Migration

```typescript
#!/usr/bin/env tsx
// migrate-config.ts

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Read OpenCode config
const opencodeConfig = JSON.parse(
  readFileSync(join(process.env.HOME!, '.config/opencode/config.json'), 'utf-8')
);

// Transform to agent-core format
const agentCoreConfig = {
  $schema: 'agent-core',
  provider: {
    model: opencodeConfig.models?.default,
    fallback: opencodeConfig.models?.fallback,
  },
  agent: {
    name: opencodeConfig.agent?.default || 'zee',
  },
  permission: opencodeConfig.agent?.permissions || { '*': 'allow' },
  instructions: opencodeConfig.instructions?.system?.split('\n') || [],
};

// Write agent-core config
writeFileSync(
  join(process.env.HOME!, '.config/agent-core/agent-core.jsonc'),
  JSON.stringify(agentCoreConfig, null, 2)
);

console.log('Configuration migrated successfully!');
```

## Monitoring

### Prometheus Metrics

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'agent-core'
    static_configs:
      - targets: ['agent-core:3210']
    metrics_path: '/metrics'
    
  - job_name: 'opencode-adapter'
    static_configs:
      - targets: ['opencode-adapter:8080']
    metrics_path: '/metrics'
```

### Health Checks

```bash
# Check agent-core health
curl http://localhost:3210/health

# Check adapter health
curl http://localhost:8080/health

# Full stack check
./scripts/health-check.sh
```

### Logging

```yaml
# fluentd config for centralized logging
<source>
  @type forward
  port 24224
</source>

<filter opencode.**>
  @type parser
  format json
  key_name log
</filter>

<match opencode.**>
  @type elasticsearch
  host elasticsearch
  port 9200
  index_name opencode
  type_name _doc
</match>
```

## Troubleshooting

### Common Issues

**1. Connection Refused**
```bash
# Check if services are running
curl http://localhost:3210/health
curl http://localhost:8080/health

# Check logs
docker-compose logs agent-core
docker-compose logs opencode-adapter
```

**2. Authentication Errors**
```bash
# Verify auth configuration
agent-core debug config
cat ~/.config/opencode-adapter/config.yaml

# Test with explicit auth
curl -u username:password http://localhost:3210/session
```

**3. Session Sync Issues**
```bash
# Force session sync
opencode-adapter sync --force

# Reset sync state
rm ~/.cache/opencode-adapter/sync-state.json
```

### Debug Mode

```bash
# Start with verbose logging
DEBUG=opencode-adapter:* opencode-adapter --verbose

# Trace HTTP requests
DEBUG=agent-core:* agent-core daemon --trace
```

## Security Best Practices

1. **Enable Authentication**
   ```bash
   export AGENT_CORE_ENABLE_SERVER_AUTH=1
   export AGENT_CORE_SERVER_PASSWORD=$(openssl rand -base64 32)
   ```

2. **Use HTTPS in Production**
   ```yaml
   # With reverse proxy (nginx/traefik)
   services:
     agent-core:
       environment:
         - TRUST_PROXY=true
   ```

3. **Network Isolation**
   ```yaml
   # docker-compose.yml
   networks:
     backend:
       internal: true
     frontend:
   ```

4. **Secret Management**
   ```bash
   # Use Docker secrets or external vault
   echo "my-secret" | docker secret create anthropic-api-key -
   ```

## Performance Tuning

### Agent-Core

```yaml
environment:
  - NODE_OPTIONS=--max-old-space-size=4096
  - UV_THREADPOOL_SIZE=128
```

### Qdrant

```yaml
environment:
  - QDRANT__STORAGE__STORAGE_PATH=/qdrant/storage
  - QDRANT__STORAGE__SNAPSHOTS_PATH=/qdrant/snapshots
  - QDRANT__STORAGE__WAL_CAPACITY_MB=32
```

### Adapter

```yaml
environment:
  - UV_THREADPOOL_SIZE=64
  - CACHE_TTL=300
  - MAX_CONCURRENT_REQUESTS=100
```
