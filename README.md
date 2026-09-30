# PIXEL

Local-first AI engineering & agent execution environment for macOS.

`Run → Agent → Role → Model → Provider → Tools → Environment → Events → Artifacts → Usage → Evaluation`

## Quick start

```bash
npm install
npm run dev            # launch in development
npm test               # unit + integration tests (vitest)
npm run test:e2e       # build + Playwright end-to-end tests against Electron
npm run dist           # unsigned PIXEL.app in dist/mac-arm64
```

`npm install` downloads the Electron binary via a postinstall step (npm 11 can skip dependency install scripts). If you ever see `Error: Electron uninstall`, run `node node_modules/electron/install.js`.

No API keys are required: **Home → Load the demo council** runs a Table of Agents on three deterministic offline providers.

## Architecture

All business logic lives in `src/core` (Electron-free, fully tested). `src/main` is a thin shell: a composition root (`PixelApp`), one validated IPC channel and push events. The renderer never sees secrets or calls Node.

| Module | Responsibility |
|---|---|
| `providers/` | Provider interface, registry, adapters (Anthropic SDK, OpenAI-compatible for OpenAI/OpenRouter/gateways/local servers, Gemini, offline demo), BYOK manager |
| `models/` | Pricing/capability metadata that enriches discovery; unknown pricing stays unknown |
| `roles/` | Constitutions: free-text rules rendered to the model and structured fields enforced by PIXEL |
| `agents/` | Agent spec (role + model + rules + tools + permissions), context assembly with provenance, runner with tool loop and contract validation |
| `teams/` | Table of Agents: independent proposals → blind cross-review → rebuttal → resolution → adjudication → governance |
| `governance/` | Deterministic layered engine (safety > system > project > table > role > agent > task), approvals |
| `evaluation/` | Structured output contracts and judgment records (conclusions and evidence, never hidden reasoning) |
| `tools/`, `git/`, `browser/`, `computer/`, `mcp/` | Local execution behind permissions and governance; sandboxed FS, isolated git worktrees, MCP stdio client |
| `workflows/` | DAG engine: parallel branches, conditions, approvals, retries, timeouts, loops, cancellation |
| `runs/`, `events/`, `usage/`, `artifacts/` | Run orchestration, snapshots for replay/branch, append-only redacted event journal, usage and cost accounting |
| `storage/` | SQLite (libsql) + Drizzle schema and migrations (`drizzle/`) |

### Governance semantics

Every applicable rule yields `ALLOW | RETRY | REROUTE | WAIT | ESCALATE | BLOCK`, and the most restrictive decision wins. Lower layers can only tighten. Only a strictly higher layer may waive a rule, and safety rules cannot be waived. Safety and system policies are loaded from code, not the database.

### Secrets

API keys go from the input field → main process → macOS Keychain (`dev.pixel.workbench`). SQLite stores only a non-reversible fingerprint. Known key shapes and every loaded secret are redacted from events, errors and tool output.

## Environment variables

| Variable | Purpose |
|---|---|
| `PIXEL_DATA_DIR` | Override the data directory |
| `PIXEL_CREDENTIAL_STORE=memory` | Use an in-memory credential store (tests) |
| `PIXEL_MOCK_LATENCY` | Scale the simulated latency of the demo providers (0 = instant) |
