## 2024-05-22 - Config Redaction
**Vulnerability:** The `GET /config` endpoint was returning the full configuration object, including sensitive fields like `apiKey`, `token`, and `clientSecret`. This allowed any authenticated user (or unauthenticated if auth is disabled) to retrieve secrets.
**Learning:** Configuration objects often contain mixed sensitivity data. Returning the whole object by default is a common pitfall. Explicit redaction layers are necessary at the API boundary.
**Prevention:** Implement a `Redactable` interface or helper for configuration objects. Enforce usage of `redact()` in API responses.
