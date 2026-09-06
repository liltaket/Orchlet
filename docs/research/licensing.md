# Open-Source Licensing & IP Strategy for Orchlet

## 1. Executive Summary & Policy

Orchlet is an open-source, production-minded AI coding-agent orchestration control plane. The project is licensed under the permissive **MIT License**, committed to `C:/Users/bruno/Orchlet/LICENSE`.

To maintain pristine open-source intellectual property hygiene and ensure enterprise adoptability, Orchlet enforces the following strict legal and licensing guidelines:
1. **Zero Copyleft Contamination**: Orchlet core, server, adapters, and packages do not include or copy source code from GPL-2.0, GPL-3.0, AGPL-3.0, or SSPL licensed projects.
2. **Clean-Room Engineering**: All integrations with external or proprietary developer tools (such as T3 Code, OpenAI Codex, Google Antigravity, Claude Code, OpenCode, and Paseo) are developed strictly via clean-room protocol analysis, public documentation, published client schemas, and external API/WebSocket interfaces.
3. **Third-Party Attribution**: All runtime dependencies, external protocols, and architectural inspirations are explicitly attributed in [`THIRD_PARTY.md`](file:///C:/Users/bruno/Orchlet/THIRD_PARTY.md).
4. **No Proprietary Brand Infringement**: Orchlet does not claim ownership or endorsement from third-party trademark owners. Integration layers are clearly marked as independent adapters.
5. **No Personal or Machine Identity Leakage**: Orchlet code, configuration templates, tests, and documentation must never embed private machine hostnames, internal paths, individual developer names, or proprietary tokens.

---

## 2. Permissive vs. Copyleft Audit Matrix

| Upstream / Ecosystem Component | License | Permitted in Orchlet Monorepo? | Architectural Usage Model |
| :--- | :--- | :--- | :--- |
| **Orchlet Control Plane** | MIT | Native Primary License | Complete permissiveness for commercial and open-source users. |
| **Paseo (`getpaseo/paseo`)** | MIT / Apache 2.0 | Reference / Conceptual Pattern Only | Worktree isolation directory pattern (`.orchlet/worktrees/...`) and setup/teardown hooks. No direct binary bundling. |
| **Gajae Code (`Yeachan-Heo/gajae-code`)** | MIT | Reference / Pattern | Multi-account model routing, tiered provider resolution, and role assignment matrices. |
| **OpenCode (`@opencode-ai`)** | Apache-2.0 / MIT | Compatible Runtime Dependency / Child Process | Spawns `opencode serve` CLI or connects over HTTP API. |
| **Effect-TS (`effect`)** | MIT | Direct Dependency | Used for robust typed HTTP/RPC error modeling, schemas, and resource fibers where appropriate. |
| **Octokit (`@octokit/*`)** | MIT | Direct Dependency | Official GitHub REST and GraphQL SDK for PR and CI babysitting. |
| **T3 Code Engine** | Proprietary / Mixed | Clean Protocol Adapter ONLY | Clean-room WebSocket RPC / HTTP client (`t3-adapter`). Zero private runtime code copied. |

---

## 3. Clean-Room Architecture for Adapters

When integrating with developer environments that may have mixed or evolving licensing:
- **Separation of Concerns**: Adapters live in isolated workspace packages (`@orchlet/t3-adapter`, `@orchlet/providers`, `@orchlet/github`).
- **Contract Boundary**: Orchlet core defines vendor-neutral TypeScript interfaces (`AgentProvider`, `UsageProvider`, `WorkspaceManager`, `ReviewEngine`, `WorkflowBabysitter`).
- **Dynamic Feature Detection**: Adapters query runtime capabilities at startup (e.g. `GET /.well-known/t3/environment` or `POST /api/auth/session`) rather than hardcoding unstable version assumptions.
- **Fail-Soft Graceful Degradation**: If an external provider lacks a capability (e.g. out-of-band usage tracking or branch auto-merge), Orchlet gracefully degrades to fallback behavior without crashing the orchestration loop.

---

## 4. Compliance Checklist for Release Readiness

- [x] Root `LICENSE` file contains standard MIT license text.
- [x] [`THIRD_PARTY.md`](file:///C:/Users/bruno/Orchlet/THIRD_PARTY.md) catalogs all external dependencies, licenses, and notices.
- [x] No GPL/AGPL copyleft libraries present in `package.json` dependencies.
- [x] No private keys, bearer tokens, or local machine identifiers hardcoded in codebase.
- [x] Strict test suite validates adapter isolation without requiring external proprietary services in mock mode.
