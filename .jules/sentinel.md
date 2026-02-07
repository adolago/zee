## 2025-05-23 - Hardcoded Credentials in Utility Scripts
**Vulnerability:** A standalone utility script (`tuwel_scraper.mjs`) contained hardcoded credentials (email and password) and generated artifacts (`tuwel_dashboard.png`, `tuwel_exams.json`) that leaked sensitive information (scraped data, screenshot of login).
**Learning:** Utility scripts and "one-off" tools often bypass standard security reviews and CI checks, becoming a common source of secret leaks. Developers may commit them thinking they are "local only" but they persist in the history.
**Prevention:**
1. Always use environment variables for credentials, even in "throwaway" scripts.
2. Ensure `.gitignore` covers potential output files of any script added to the repo.
3. Treat all code in the repository as production-grade regarding security practices.
