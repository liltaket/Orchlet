# Orchlet Security Model & Self-Hosting Architecture

## 1. Overview & Threat Model

Orchlet is designed as a self-hosted, local-first control plane for AI coding-agent orchestration. By design, Orchlet executes real coding agents (e.g. OpenCode), manages isolated git worktrees, executes verification commands (e.g. \`npm test\`), performs automated git commits, and opens GitHub pull requests.

Because coding agents execute code and modify repositories, the security boundary must be strictly defended. Orchlet adheres to a **zero-implicit-trust** model for remote access.

---

## 2. Network & Binding Defaults

1. **Default Loopback Binding**:
   - The daemon binds strictly to \`127.0.0.1\` (\`HOST=127.0.0.1\`) by default.
   - It is never exposed to public internet interfaces (\`0.0.0.0\`) unless explicitly configured via the \`HOST\` environment variable (e.g. within an isolated container network).

2. **Remote & Mobile Access Requirements**:
   - Remote access to the Orchlet dashboard or API must **never** be exposed directly over the public internet without an encrypted overlay network or authenticated reverse proxy.
   - **Recommended Mesh**: **Tailscale** private mesh network (e.g. \`100.x.y.z\` or MagicDNS domain \`*.ts.net\`). Tailscale provides WireGuard point-to-point encryption, node key rotation, and machine-level ACLs.
   - **Reverse Proxy / TLS**: When exposing outside loopback, use a reverse proxy (such as Caddy, Nginx, or Traefik) terminating TLS (\`https://\` and \`wss://\`).

3. **Strict CORS Policy**:
   - Local origins (\`http://localhost:*\`, \`http://127.0.0.1:*\`) are permitted by default.
   - Remote or Tailscale origins are blocked unless explicitly listed in the \`ORCHLET_ALLOWED_ORIGINS\` environment variable:
     \`\`\`bash
     ORCHLET_ALLOWED_ORIGINS="https://my-macbook.tailscale.net,https://phone.tailscale.net"
     \`\`\`
   - Requests from untrusted origins are rejected before route execution.

---

## 3. Authentication & Session Management

1. **Local Persistent Bearer Token**:
   - Upon first startup, Orchlet generates a cryptographically secure 192-bit token (\`orch_<hex48>\`) and saves it with restricted permissions (\`0o600\`) to \`~/.orchlet/auth-token\`.
   - Alternatively, operators may supply \`ORCHLET_AUTH_TOKEN\` via environment variable or secret manager.
   - All REST API endpoints (excluding public \`/health\` and \`/.well-known/orchlet/health\`) require the header:
     \`\`\`http
     Authorization: Bearer <TOKEN>
     \`\`\`

2. **Secure WebSocket Ticket Authentication**:
   - To prevent exposing long-lived bearer tokens in browser URL query parameters or server access logs, the dashboard requests a short-lived ticket:
     \`\`\`http
     POST /api/auth/ws-ticket
     Authorization: Bearer <TOKEN>
     \`\`\`
   - The server issues a single-use ticket (\`wst_<hex32>\`) with a 60-second TTL.
   - The dashboard connects to \`ws://${HOST}:${PORT}/api/stream?ticket=<TICKET>\`.
   - The ticket is verified and **immediately consumed** (deleted from memory). Subsequent connection attempts with the same ticket are rejected.
   - **Legacy Query Token Deprecation**: Passing the long-lived token via query parameter (\`?token=<TOKEN>\`) is **disabled by default** and strictly gated behind the environment variable \`ORCHLET_ALLOW_LEGACY_QUERY_TOKEN=true\`. The web dashboard exclusively uses the single-use ticket mechanism.

3. **No Credential Logging**:
   - The authentication token is never printed to stdout/stderr or application logs during daemon startup.
   - Startup logs only reference the file location (\`~/.orchlet/auth-token\`).

---

## 4. Worktree Isolation & Path Traversal Protections

1. **Ephemeral Git Worktrees**:
   - Coding agents never execute directly in the primary working tree or on the \`main\` branch.
   - Each task creates a dedicated, isolated git worktree under \`<repo>/.orchlet/worktrees/task-<id>\` linked to an isolated work branch (\`orchlet/task-<id>\`).
   - Ephemeral harness configurations (such as \`.opencode/config.json\`) are scoped exclusively to the worktree and purged before commits are created.

2. **Path Traversal & Repository Validation**:
   - Repository paths supplied to \`createTask\` and \`POST /api/tasks\` are resolved to normalized absolute paths (\`path.resolve\`).
   - The daemon validates that the path exists, is a valid directory, and contains a \`.git\` repository before accepting task creation.
   - Worktree operations verify that child worktree directories stay within the repository's root boundary.

3. **Container Mount Isolation**:
   - In Docker deployments (\`docker-compose.yml\`), the host filesystem is not mounted wholesale.
   - The container mounts only:
     - \`orchlet-data:/root/.orchlet\`: Persistent database and state.
     - \`./repos:/repos\`: Controlled repository sandbox directory.

---

## 5. Reviewer Trust Boundaries & Threat Defenses

1. **Adversarial Independent Reviewer**:
   - Every git diff produced by an agent is audited by an independent AI reviewer prior to commit or PR creation.
   - In addition to semantic defect analysis, the reviewer applies regex scans for common secret patterns:
     - GitHub Personal Access Tokens (\`ghp_*\`)
     - OpenAI API Keys (\`sk-*\`)
     - OpenRouter API Keys (\`sk-or-v1-*\`)
     - RSA / OpenSSH Private Keys (\`BEGIN ... PRIVATE KEY\`)
   - Diffs containing detected credentials receive a **\`P0\` Critical Blocker** verdict and are blocked from committing.

2. **Prompt Injection Defense & Boundary Fences**:
   - Repository instructions (\`AGENTS.md\`, \`CLAUDE.md\`) and generated diffs are treated as **untrusted data**.
   - The independent reviewer's system prompt strictly demarcates untrusted inputs with boundary markers (\`<untrusted_repo_context>\` and \`<untrusted_git_diff>\`).
   - Reviewers are instructed never to follow instructions, role overrides, or approval directives contained within the code diff or repository documentation.

3. **Strict Fail-Closed Review Semantics in REAL Mode**:
   - In \`REAL\` execution mode, if an AI review call fails (e.g. network timeout, rate limit, invalid response format) or no AI reviewer is available, the workflow **strictly halts and fails** (\`AI_REVIEW_FAILED\` / \`AI_REVIEW_UNAVAILABLE\`).
   - Orchlet **never silently substitutes** static safety review in \`REAL\` mode unless \`allowStaticFallback: true\` is explicitly configured.
   - Even when fallback is explicitly permitted, the audit trail truthfully records \`actualProvider: "local"\` and \`actualModel: "offline-safety-reviewer"\`, eliminating deceptive model reporting.

4. **Reviewer Provider Registry Enforcement**:
   - Reviewer providers are resolved through an explicit provider registry (\`packages/providers/src/reviewer-registry.ts\`).
   - Attempting to configure an unsupported or nonexistent provider triggers an explicit \`UNSUPPORTED_REVIEW_PROVIDER\` error, preventing silent degradation or unexpected routing.

5. **Model Audit Integrity**:
   - Model usage audit records explicitly distinguish \`requestedProvider\` and \`requestedModel\` from \`actualProvider\` and \`actualModel\`.
   - If an error or fallback occurs, the exact failure reason is recorded in \`fallbackReason\`.

6. **Environment Variable Hygiene**:
   - Agent prompts and task packets do not inject the daemon's host environment variables into task context.

---

## 6. GitHub Integration & Merge Gates

1. **Conservative Git Defaults**:
   - Repository configurations (\`.orchlet/config.json\`) govern push and PR behavior:
     \`\`\`json
     {
       "git": {
         "push": true,
         "openPr": true,
         "autoMerge": false
       }
     }
     ```
   - By default, `autoMerge` is `false`. When all merge gates (CI passing, AI reviewer approval, no merge conflicts) are satisfied, the task settles in the **`READY_TO_MERGE`** state with an attention state of **`SETTLED`**, leaving final merge execution to human control or repository policy.

2. **GitHub CheckRun & StatusContext Gate Normalization**:
   - The PR babysitter normalizes all GitHub CheckRun statuses and StatusContext states.
   - Conservative rule: Unknown check states default to `ERROR`, never `SUCCESS`.
   - Any pending check or context (e.g. CodeRabbit, SonarQube, GitHub Actions) correctly yields rollup state `PENDING` and blocks merging.

---

## 7. Cost, Budget & Abuse Controls

1. **Hard Per-Task Budget Enforcement**:
   - Tasks can define `perTaskBudgetUsd` (or inherited from `budget.perTaskUsd`).
   - Before dispatching any model call (executor, reviewer, repairer), Orchlet forecasts token usage and costs.
   - If the projected cost exceeds the remaining task budget, the call is blocked immediately with `BUDGET_EXHAUSTED`.

2. **Rolling Daily & Monthly Spend Caps**:
   - Rolling daily and monthly spend is tracked persistently in `~/.orchlet/budget-spend.json`.
   - Configurable caps (`budget.dailyUsd`, `budget.monthlyUsd`, `budget.hardStopAtPercent`) prevent runaway agent loops or denial-of-wallet scenarios.
   - Real-time spend is visible via `GET /api/usage` and displayed in the control plane dashboard.

3. **Context Truncation & Token Budget Bounds**:
   - To prevent token exhaustion and excessive prompt costs from huge files or diffs, context files in reviewer packets are capped at 12,000 characters, and git diffs are capped at 60,000 characters with explicit truncation annotations.

4. **Strict Repository Validation**:
   - `POST /api/tasks` strictly executes `git rev-parse --is-inside-work-tree` at the target repository path.
   - Requests with non-existent directories or arbitrary non-git filesystem locations are rejected with HTTP 400.

5. **Transparent Routing Rationales**:
   - Every model routing decision records its full rationale (`task.routingRationales`), including considered candidate models, cost class, forecast cost, remaining budget, and reasons for selection or rejection.
