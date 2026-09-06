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

3. **No Credential Logging**:
   - The authentication token is never printed to stdout/stderr or application logs during daemon startup.
   - Startup logs only reference the file location (\`~/.orchlet/auth-token\`).

---

## 4. Worktree Isolation & Path Traversal Protections

1. **Ephemeral Git Worktrees**:
   - Coding agents never execute directly in the primary working tree or on the \`main\` branch.
   - Each task creates a dedicated, isolated git worktree under \`<repo>/.orchlet/worktrees/task-<id>\` linked to an isolated work branch (\`orchlet/task-<id>\`).
   - Ephemeral harness configurations (such as \`.opencode/config.json\`) are scoped exclusively to the worktree and purged before commits are created.

2. **Path Traversal Guards**:
   - Repository paths supplied to \`createTask\` are resolved to normalized absolute paths (\`path.resolve\`).
   - Worktree operations verify that child worktree directories stay within the repository's root boundary.

3. **Container Mount Isolation**:
   - In Docker deployments (\`docker-compose.yml\`), the host filesystem is not mounted wholesale.
   - The container mounts only:
     - \`orchlet-data:/root/.orchlet\`: Persistent database and state.
     - \`./repos:/repos\`: Controlled repository sandbox directory.

---

## 5. Secret Leakage Prevention

1. **Adversarial Independent Reviewer**:
   - Every git diff produced by an agent is audited by the independent reviewer prior to commit or PR creation.
   - In addition to semantic defect analysis, the reviewer applies regex scans for common secret patterns:
     - GitHub Personal Access Tokens (\`ghp_*\`)
     - OpenAI API Keys (\`sk-*\`)
     - OpenRouter API Keys (\`sk-or-v1-*\`)
     - RSA / OpenSSH Private Keys (\`BEGIN ... PRIVATE KEY\`)
   - Diffs containing detected credentials receive a **\`P0\` Critical Blocker** verdict and are blocked from committing.

2. **Environment Variable Hygiene**:
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
     \`\`\`
   - By default, \`autoMerge\` is \`false\`. When all merge gates (CI passing, AI reviewer approval, no merge conflicts) are satisfied, the task settles in the **\`READY_TO_MERGE\`** state with an attention state of **\`SETTLED\`**, leaving final merge execution to human control or repository policy.
