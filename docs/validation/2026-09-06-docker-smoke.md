# Docker Runtime Validation Record

- **Date**: 2026-09-06
- **Status**: \`BLOCKED_BY_ENVIRONMENT\` (Container engine daemon stopped; Dockerfile & Compose assets verified)
- **Environment**: Windows 11 Host, non-elevated user shell
- **Docker CLI Version**: 28.5.1, build e180ab8
- **Docker Daemon Service**: \`com.docker.service\` (Windows Service status: \`Stopped\`)

---

## 1. Environment Findings & Verification Attempt

1. **Docker CLI Check**:
   \`\`\`powershell
   docker --version
   # Output: Docker version 28.5.1, build e180ab8
   \`\`\`
2. **Daemon Connectivity**:
   Attempting to connect to the Docker daemon pipe (\`//./pipe/dockerDesktopLinuxEngine\`) returned:
   \`\`\`
   open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
   \`\`\`
3. **Service State**:
   Checking Windows services revealed:
   \`\`\`powershell
   Get-Service com.docker.service
   # Status: Stopped
   \`\`\`
   In the active non-elevated user execution context, starting Windows background services (\`Start-Service com.docker.service\`) is restricted by OS policy without interactive administrative UAC elevation.
4. **WSL2 Subsystem Verification**:
   Examined installed WSL distributions (\`wsl -l -v\`):
   - \`Ubuntu\` (Version 2, Stopped)
   - \`docker-desktop\` (Version 2, Stopped)

---

## 2. Docker Packaging & Container Specification Audit

Orchlet provides a production-hardened multi-stage \`Dockerfile\` and \`docker-compose.yml\` designed for containerized self-hosting:

### Dockerfile Architecture
- **Base Image**: \`node:22-slim\` with Corepack / PNPM enabled.
- **System Toolchain**: Installs official GitHub CLI (\`gh\`), \`git\`, \`curl\`, \`ca-certificates\`.
- **Agent Harness CLI**: Globally installs \`opencode-ai\` CLI.
- **Build Stage**: Compiles all monorepo packages (\`pnpm -r run build\`) including `@orchlet/workflow-engine`, `@orchlet/server`, and `@orchlet/dashboard`.
- **Runner Stage**: Minimal production footprint, mounts built dashboard to static server assets, exposes port \`4774\`.
- **Healthcheck**: Performs HTTP fetch against \`http://127.0.0.1:4774/health\` with 30s interval, 5s timeout, 3 retries.

### Docker Compose Architecture (\`docker-compose.yml\`)
- **Port Mapping**: \`4774:4774\`
- **Volume Isolation**:
  - \`orchlet-data:/root/.orchlet\`: Persistent SQLite database (\`tasks.db\`) and authentication token (\`auth-token\`).
  - \`./repos:/repos\`: Controlled repository mount preventing arbitrary host filesystem traversal.
- **Environment Passthrough**:
  - \`PORT=4774\`
  - \`HOST=0.0.0.0\`
  - \`OPENROUTER_API_KEY\`
  - \`GITHUB_TOKEN\`

---

## 3. Truthful Status

Per Orchlet verification policy, because the Docker daemon cannot be started without administrator UAC elevation on this host, Docker container execution is classified as:
**\`BLOCKED_BY_ENVIRONMENT\`** (Not marked as empirically \`VERIFIED\` until run against an active Docker daemon).
