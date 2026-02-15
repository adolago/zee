#!/bin/bash
# Stanley Health Check Script
# Used by Docker health checks and monitoring systems

set -e

# Configuration
API_HOST="${STANLEY_API_HOST:-localhost}"
API_PORT="${STANLEY_API_PORT:-8000}"
HEALTH_ENDPOINT="/api/health"
TIMEOUT="${HEALTH_TIMEOUT:-5}"

# Perform health check
response=$(curl -sf --max-time "$TIMEOUT" "http://${API_HOST}:${API_PORT}${HEALTH_ENDPOINT}" 2>/dev/null) || exit 1

# Check response status
if echo "$response" | grep -q '"status":\s*"healthy"'; then
    exit 0
else
    echo "Unhealthy response: $response" >&2
    exit 1
fi
