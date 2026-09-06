# Third-Party Notices & Attribution

Orchlet incorporates ideas, protocol patterns, and open-source software libraries. This file documents upstream software components, their respective licenses, and attributions.

---

## 1. Upstream Concepts & Protocol Inspirations

### Paseo (`getpaseo/paseo`)
- **License**: MIT / Apache 2.0
- **Upstream Project**: [https://github.com/getpaseo/paseo](https://github.com/getpaseo/paseo)
- **Role & Inspiration**: Orchlet draws inspiration from Paseo's Git worktree isolation architecture (`worktree` directory lifecycle, setup scripts, and independent diff reviews) for parallel agent sandboxing.

### Gajae Code (`Yeachan-Heo/gajae-code`)
- **License**: MIT
- **Upstream Project**: [https://github.com/Yeachan-Heo/gajae-code](https://github.com/Yeachan-Heo/gajae-code)
- **Role & Inspiration**: Orchlet incorporates concepts from Gajae Code's multi-tiered model resolution (`fast`, `balanced`, `strong`), cost-weighted subagent routing, and dynamic multi-account quota failover.

### OpenCode AI (`opencode-ai`)
- **License**: Apache 2.0
- **Upstream Project**: [https://github.com/opencode-ai/opencode](https://github.com/opencode-ai/opencode)
- **Role & Inspiration**: Orchlet supports OpenCode as a pluggable execution engine via its native CLI child-process and HTTP server interfaces, adhering to standard agent conventions.

---

## 2. Open-Source Runtime Dependencies

The following open-source packages are utilized within Orchlet:

| Package | License | Repository |
| :--- | :--- | :--- |
| `effect` | MIT | [https://github.com/Effect-TS/effect](https://github.com/Effect-TS/effect) |
| `@octokit/core`, `@octokit/plugin-rest-endpoint-methods` | MIT | [https://github.com/octokit](https://github.com/octokit) |
| `better-sqlite3` | MIT | [https://github.com/WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| `zod` | MIT | [https://github.com/colinhacks/zod](https://github.com/colinhacks/zod) |
| `fastify` / `express` | MIT | [https://github.com/fastify/fastify](https://github.com/fastify/fastify) |
| `ws` | MIT | [https://github.com/websockets/ws](https://github.com/websockets/ws) |
| `execa` | MIT | [https://github.com/sindresorhus/execa](https://github.com/sindresorhus/execa) |
| `simple-git` | MIT | [https://github.com/steveukx/git-js](https://github.com/steveukx/git-js) |
| `vitest` | MIT | [https://github.com/vitest-dev/vitest](https://github.com/vitest-dev/vitest) |

---

## 3. Clean-Room External Integration Notices

- **T3 Code Integration**: Orchlet's `@orchlet/t3-adapter` interacts with T3 Code via its loopback HTTP and WebSocket RPC protocols. T3 Code is a trademark of its respective owners. Orchlet is an independent open-source project and is not affiliated with or endorsed by T3 Code.
- **GitHub Integration**: Orchlet utilizes the GitHub API and GitHub CLI (`gh`) under GitHub's standard API Terms of Service.
- **AI Provider Integrations**: Integrations with OpenRouter, OpenAI, Google Gemini, and Anthropic Claude communicate over public standard HTTP, WebSocket, and ACP protocols conforming to their respective API terms.
