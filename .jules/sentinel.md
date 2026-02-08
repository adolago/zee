# Sentinel's Journal

## 2026-02-08 - Hardcoded Credentials in Scraper Script
**Vulnerability:** Found hardcoded email and password in `tuwel_scraper.mjs` script, exposing student credentials and potentially personal data.
**Learning:** Standalone utility scripts are often overlooked during security reviews and may bypass standard configuration management (like `.env` files). Developers may treat them as "local-only" but they can easily be committed.
**Prevention:** Extend secret scanning to all files in the repository, including `.mjs` and other script extensions. Ensure all "temporary" scripts use environment variables and have their output files gitignored by default.
