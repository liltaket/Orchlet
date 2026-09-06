# Licensing, Clean-Room IP Strategy, and Attribution

This document outlines the intellectual property, copyright, and third-party code policy for **Orchlet**.

---

## 1. Primary License: MIT

Orchlet is released under the permissive **MIT License**.
See [LICENSE](../../LICENSE) for the full license text.

---

## 2. Clean-Room IP & Independence Strategy

To guarantee that Orchlet is an independent, community-owned, vendor-neutral project:

1. **Zero Proprietary Code Copying**:
   - No decompiled code, internal ASTs, or unpublished binary extracts from proprietary coding agents may be copied into Orchlet.
   - All protocols, adapters, and interfaces are developed purely against observed public network contracts, local loopback sockets, documented APIs, or clean-room functional specifications.

2. **Clean-Room Specification Pattern**:
   - Architectural decisions and research documents in `docs/research/` document the observed external behaviors and API boundaries of tools (T3 Code, OpenCode, Paseo, Gajae Code).
   - The implementation code in `packages/` and `apps/` is written independently from first principles.

3. **Vendor Neutrality**:
   - No hardcoded personal machine paths, usernames, or internal network endpoints are permitted in source code.
   - Any machine-specific or user-specific configuration must reside in local ignored environment files (`.env`, `~/.orchlet/config.json`) or be passed via CLI arguments.

---

## 3. Third-Party Attribution & Dependencies

All external open-source dependencies used in Orchlet are cataloged in [THIRD_PARTY.md](../../THIRD_PARTY.md).

### Criteria for Direct Runtime Dependencies:
- Must carry a permissive open-source license: **MIT**, **Apache 2.0**, **BSD-2-Clause**, **BSD-3-Clause**, or **ISC**.
- **Copyleft (GPL, AGPL, LGPL)** dependencies are strictly prohibited in runtime packages to preserve maximum flexibility for enterprise and individual adopters.
- Native binary dependencies are avoided where Node.js built-ins exist (e.g. using `node:sqlite` instead of requiring C++ compilation chains on developer machines).

---

## 4. Attributions & Research References

| Project | Organization / Author | Observed Conceptual Patterns | License |
|---|---|---|---|
| **Paseo** | `getpaseo/paseo` | Ephemeral git worktree lifecycle (`.orchlet/worktrees/`) | MIT |
| **Gajae Code** | `Yeachan-Heo/gajae-code` | Model tiering (`fast`, `balanced`, `strong`) & multi-role orchestration | MIT |
| **OpenCode** | `anomalyco/opencode` | Nearest-first instruction discovery (`AGENTS.md`) | MIT |
| **Fastify** | OpenJS Foundation / Fastify Team | High-performance HTTP & WebSocket daemon | MIT |
| **Octokit / GitHub CLI** | GitHub, Inc. | PR automation & check-run polling | MIT |

For detailed licensing notices of dependencies, refer to [THIRD_PARTY.md](../../THIRD_PARTY.md).
