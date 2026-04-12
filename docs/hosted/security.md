# Hosted Security Model

This hosted implementation is designed for local or self-managed deployments. It provides baseline security controls while keeping the stack lightweight.

## Authentication and sessions

- API access uses email/password accounts (via `/api/auth/*`) with salted, scrypt-derived password hashes.
- Sessions are stored in SQLite and expire based on `HOSTED_SESSION_TTL_HOURS`.

## Provider credentials

- Provider API keys are encrypted before storage using AES-256-GCM.
- Set `HOSTED_VAULT_KEY` to a 32-byte base64 value or a strong passphrase.
- The vault key is required to decrypt stored credentials.

## API keys

- Workspace API keys are stored as SHA-256 hashes.
- Keys are only shown once at creation time.

## Share API

- Share creation can be protected by `HOSTED_API_KEYS`.
- Basic rate limiting is enforced per IP address.
- Shares expire based on `HOSTED_SHARE_TTL_HOURS`.

## Retention

- Logs are pruned according to retention settings.
- Defaults are configured via `HOSTED_RETENTION_LOGS_DAYS`.
