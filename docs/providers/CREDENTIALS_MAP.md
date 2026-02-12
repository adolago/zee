# Credentials Map (zee / Zee / Stanley)

This document maps **where credentials live** and **which features depend on them**.

This file must never contain secret values (tokens, API keys, cookies).

## Storage locations

- `~/.local/share/zee/auth.json`  
  Provider auth used by zee (OAuth, API key, and well-known tokens). Manage with `zee auth login ...`.
- `~/.config/zee/daemon.env`  
  Environment variables used by the systemd user service.
- Shell profiles (e.g., `~/.profile`, `~/.bashrc`)  
  Environment variables for interactive usage.
- `~/.openbb_platform/user_settings.json`  
  OpenBB provider credentials (per-provider keys).
- `~/.whoop-cli/tokens.json`  
  WHOOP access/refresh tokens (whoopskill).

## Quick checks

```bash
# List stored provider auth (IDs + types)
zee auth list

# Inspect raw auth store (IDs only)
jq 'keys' ~/.local/share/zee/auth.json
```

## Common env vars

| Env var | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI API (optional if using `zee auth login openai`) |
| `ANTHROPIC_API_KEY` | Anthropic API (optional if using `zee auth login anthropic`) |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Google Gemini API (LLM/STT). Memory embeddings use `zee auth login google`. |
| `VOYAGE_API_KEY` | Voyage reranking (optional) |
| `SEC_IDENTITY` | SEC EDGAR identity |

## Zee skill env vars (common)

| Skill | Required env vars |
|---|---|
| `brave-search` | `BRAVE_API_KEY` |
| `news-digest` | `BRAVE_API_KEY` |
| `home-assistant` | `HASS_SERVER`, `HASS_TOKEN` |
| `whoopskill` | `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI` |
| `minimax-tts` | `MINIMAX_API_KEY` |

## Notes

- For OpenBB, keys live in `~/.openbb_platform/user_settings.json` under `"credentials"`.
- If you rotate a key, update it in the appropriate provider store and in `daemon.env` if zee reads it from env.

## OpenBB Provider Keys (Status)

These are typically configured inside OpenBB (`~/.openbb_platform/user_settings.json` → `credentials`).

| OpenBB key | Agent-core env alias |
|---|---|
| `alpha_vantage_api_key` | `ALPHA_VANTAGE_API_KEY` |
| `benzinga_api_key` | `BENZINGA_API_KEY` |
| `biztoc_api_key` | `BIZTOC_API_KEY` |
| `bls_api_key` | `BLS_API_KEY` |
| `cftc_app_token` | `CFTC_APP_TOKEN` |
| `congress_gov_api_key` | `CONGRESS_GOV_API_KEY` |
| `econdb_api_key` | `ECONDB_API_KEY` |
| `eia_api_key` | `EIA_API_KEY` |
| `fmp_api_key` | `FMP_API_KEY` |
| `fred_api_key` | `FRED_API_KEY` |
| `intrinio_api_key` | `INTRINIO_API_KEY` |
| `nasdaq_api_key` | `NASDAQ_API_KEY` |
| `tiingo_token` | `TIINGO_TOKEN` |
| `tradier_api_key` | `TRADIER_API_KEY` |
| `tradier_account_type` | `TRADIER_ACCOUNT_TYPE` |
| `tradingeconomics_api_key` | `TRADINGECONOMICS_API_KEY` |
