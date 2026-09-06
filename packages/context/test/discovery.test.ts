import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { InstructionDiscoveryEngine } from "../src/discovery.js";

describe("InstructionDiscoveryEngine (AGENTS.md upward traversal)", () => {
  it("discovers nearest-first AGENTS.md files along directory hierarchy", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchlet-test-agents-"));
    const subDir = path.join(tempDir, "packages", "core");
    await fs.mkdir(subDir, { recursive: true });

    // Root AGENTS.md
    await fs.writeFile(
      path.join(tempDir, "AGENTS.md"),
      `---\nscope: root\n---\nGlobal instructions here`,
      "utf-8",
    );

    // Child AGENTS.md
    await fs.writeFile(
      path.join(subDir, "AGENTS.md"),
      `---\nscope: child\n---\nChild instructions take precedence`,
      "utf-8",
    );

    const engine = new InstructionDiscoveryEngine(tempDir);
    const targetFile = path.join(subDir, "index.ts");
    const discovered = await engine.discoverForPath(targetFile);

    expect(discovered.length).toBe(2);
    // Nearest-first: subDir AGENTS.md must appear before root AGENTS.md
    expect(discovered[0].frontmatter.scope).toBe("child");
    expect(discovered[1].frontmatter.scope).toBe("root");

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
