#!/bin/bash
# Stanley API Entrypoint Script
# Handles initialization and startup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Wait for PostgreSQL
wait_for_postgres() {
    log_info "Waiting for PostgreSQL..."
    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if pg_isready -h "${POSTGRES_HOST:-postgres}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-stanley}" > /dev/null 2>&1; then
            log_info "PostgreSQL is ready"
            return 0
        fi
        log_info "Waiting for PostgreSQL... attempt $attempt/$max_attempts"
        sleep 2
        attempt=$((attempt + 1))
    done

    log_error "PostgreSQL not available after $max_attempts attempts"
    return 1
}

# Wait for Redis
wait_for_redis() {
    log_info "Waiting for Redis..."
    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if redis-cli -h "${REDIS_HOST:-redis}" -p "${REDIS_PORT:-6379}" ping > /dev/null 2>&1; then
            log_info "Redis is ready"
            return 0
        fi
        log_info "Waiting for Redis... attempt $attempt/$max_attempts"
        sleep 2
        attempt=$((attempt + 1))
    done

    log_warn "Redis not available, continuing without cache"
    return 0
}

# Run database migrations (if applicable)
run_migrations() {
    log_info "Checking for database migrations..."
    # Add migration logic here if using Alembic or similar
    # alembic upgrade head
    log_info "Migrations complete"
}

# Validate configuration
validate_config() {
    log_info "Validating configuration..."

    if [ ! -f "${STANLEY_CONFIG_PATH:-/app/config/stanley.yaml}" ]; then
        log_error "Configuration file not found: ${STANLEY_CONFIG_PATH:-/app/config/stanley.yaml}"
        log_warn "Using default configuration"
    fi

    log_info "Configuration validated"
}

# Main entrypoint
main() {
    log_info "Starting Stanley API..."
    log_info "Environment: ${STANLEY_ENV:-development}"

    # Validate configuration
    validate_config

    # Wait for dependencies
    wait_for_postgres
    wait_for_redis

    # Run migrations
    run_migrations

    log_info "Starting uvicorn server..."

    # Execute the main command
    exec "$@"
}

main "$@"
