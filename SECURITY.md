# Security

## Threat model

PIXEL runs model-directed tools on your Mac. The primary adversary is **untrusted content reaching a model** (prompt injection via files, tool output, peer agents or web pages) that then tries to make an agent exfiltrate secrets, escape its workspace or run arbitrary code. Secondary: other local processes/users, and malformed data from providers.

## Controls

- **Governance outside the model** — every tool call passes explicit permissions, the role constitution and a deterministic policy engine. Safety/system policies are loaded from code, not the database.
- **Workspace confinement** — paths are normalised, symlink-resolved and must stay inside the workspace; secret files (`.env*`, keys, `.ssh`, `.npmrc`, …) are blocked case-insensitively for reads, writes and program arguments.
- **Terminal** — allow-listed programs only, invoked without a shell; inline-code flags (`node -e`, `python -c`, `find -exec`, `git -c`, …), absolute paths, `..` escapes and `$`/backtick expansion are refused. Terminal access requires per-call approval by default.
- **Secrets** — API keys live in the macOS Keychain; SQLite stores only a fingerprint; keys are never sent over plaintext HTTP to non-loopback hosts; loaded secrets and known key shapes are redacted from events, errors and tool output.
- **Electron** — context isolation, sandboxed renderer, no Node in the renderer, strict CSP, navigation/new-window/webview blocked, permission requests denied, IPC accepted only from our own renderer frame and validated with zod.
- **Packaged binary** — Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and inspector flags (so the app can't be abused as a Node runtime that inherits its Keychain access), enforce asar integrity and load code only from the asar.
- **Local data** — the data directory is `0700`; a single-instance lock prevents two processes writing the same database.

## Known limitations

- The packaged app is **ad-hoc signed**, not Developer ID signed or notarized.
- Network egress from allow-listed programs (e.g. `npm install`) is not sandboxed at the OS level; it is gated by terminal approval.
- MCP servers are user-configured local programs and run with your user's privileges.

## Reporting

Please report vulnerabilities privately to the repository owner rather than in a public issue.
