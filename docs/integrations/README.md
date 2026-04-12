# Live Integrations Setup

This guide covers the local setup needed to run Zee with real providers, OAuth credentials, and external services instead of test fixtures.

Examples assume a Linux or WSL shell from the repository root.

## 1. Create a local env file

Start from the checked-in example:

```bash
cp .env.example .env
$EDITOR .env
```

Fill only the integrations you plan to use. `.env` is local-only and gitignored.

If you already created a local `.env`, update that file instead of copying a new one.

## 2. Make the variables available to Zee

`zee.jsonc` resolves `{env:VAR}` placeholders from the current process environment.

For interactive development, export the local `.env` into your shell before launching Zee:

```bash
set -a
source .env
set +a
```

For daemon usage, copy the same assignments into `~/.config/zee/daemon.env`:

```bash
mkdir -p ~/.config/zee
cp .env ~/.config/zee/daemon.env
```

`daemon.env` may contain plain `KEY=value` lines or `export KEY=value` lines.

## 3. Minimal live setup

For the current repo configuration, the smallest useful live setup is:

- `ANTHROPIC_API_KEY` for the default main agent
- `OPENAI_API_KEY` for GPT-based flows and fallback coverage

Local SQLite memory and local embeddings work without external services.

If you want investing workflows, also point Zee at an OpenBB Platform API instance with:

- `ZEE_OPENBB_API_URL`
- optionally `ZEE_OPENBB_API_CMD`

## 4. Start local services

### Memory

Zee prepares local memory during package installation, setup, onboarding, and daemon installation. To inspect or repair it manually:

```bash
zee memory status
zee memory prepare
```

### OpenBB

Investing workflows require an OpenBB Platform API. Point `ZEE_OPENBB_API_URL` at a running instance:

```bash
export ZEE_OPENBB_API_URL=http://127.0.0.1:6900
# optional if you use a custom launcher name/path
export ZEE_OPENBB_API_CMD=openbb-api
```

For a finance workspace with provider setup prompts, run:

```bash
zee onboard --profile dcm --openbb-mode remote --acquire-keys
```

## 5. OAuth-backed integrations

### Google

Google/Gemini LLM auth is opt-in. Prefer Antigravity auth when you want Gemini models through the agent:

```bash
zee auth login google-antigravity
```

The direct Gemini API-key path is also supported:

```bash
zee auth login google
```

Calendar auth remains a separate explicit calendar-tool integration.

This is separate from memory. Zee memory embeddings are local-only by default.

## 6. Integration-specific variables

### Core providers

Usually useful first:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`

Optional provider keys:

- `OPENROUTER_API_KEY`

### Telegram

Required:

- `TELEGRAM_BOT_TOKEN`

Optional:

- `MINIMAX_API_KEY` for Telegram TTS
- `ZEE_TELEGRAM_UPDATE_TO`
- `ZEE_TELEGRAM_CALENDAR_TO`
- `ZEE_TELEGRAM_HEARTBEAT_TO`
- `ZEE_API_TOKEN`

### WhatsApp

WhatsApp uses a local bridge instead of an API key.

Configure:

- `WACLI_BIN`
- `WACLI_STORE`
- `ZEE_WA_UPDATE_TO`
- `ZEE_WA_CALENDAR_TO`

### GitHub

Required for GitHub-backed automation:

- `GITHUB_TOKEN`

Alternative commonly supported by GitHub tooling:

- `GH_TOKEN`

### WHOOP skill

Required:

- `WHOOP_CLIENT_ID`
- `WHOOP_CLIENT_SECRET`

Usually also set:

- `WHOOP_REDIRECT_URI`

### Home Assistant skill

Required:

- `HASS_TOKEN`

Optional:

- `HASS_SERVER`

### TUWEL

Uses login credentials rather than an API key:

- `TUWEL_EMAIL`
- `TUWEL_PASSWORD`
- optionally `TUWEL_BASE_URL`

### OpenBB market-data providers

Some investing workflows depend on additional provider-specific keys exposed through OpenBB-compatible integrations.

Common examples include:

- `ALPHA_VANTAGE_API_KEY`
- `FRED_API_KEY`
- `FMP_API_KEY`
- `NASDAQ_API_KEY`
- `POLYGON_API_KEY`
- `SEC_IDENTITY`

Use `zee auth acquire --free-only` to list supported free or free-registration OpenBB providers, or `zee auth acquire fred` to acquire one provider key. Zee stores compatible keys in the Zee auth store and OpenBB `user_settings.json`.

See `src/config/providers.ts` and `docs/providers/CREDENTIALS_MAP.md` for the broader provider registry.

## 7. Recommended bring-up order

1. Create or update `.env`
2. Source `.env` into your shell
3. Run `zee memory status`
4. Run `zee auth login google` only if you need Calendar access
5. Start or point at OpenBB if you need investing workflows
6. Launch Zee

## 8. Quick verification

After sourcing `.env`, verify the basic runtime:

```bash
zee --version
zee paths
zee gateway status
```

If you are using the daemon, restart it after updating `daemon.env` so the new environment is picked up.

## 9. Notes

- Do not commit `.env` or `daemon.env`.
- OpenBB is an optional service dependency, not an API key.
- The automated test suite does not validate live external integrations; those need separate runtime verification with real credentials.
