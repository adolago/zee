## 2025-05-24 - PTY Path Traversal
**Vulnerability:** The `Pty.create` service allowed initializing a shell session with a `cwd` outside the project directory, enabling command execution in arbitrary paths (sandbox escape equivalent).
**Learning:** Even when security utilities (like `Filesystem.containsResolved`) exist, their usage must be explicitly enforced in all entry points. Documentation/Memory might claim security measures exist that are actually missing in code.
**Prevention:** Always verify that `cwd` and file path parameters are validated against `Instance.directory` using `Filesystem.containsResolved` before passing them to `spawn` or file operations.
