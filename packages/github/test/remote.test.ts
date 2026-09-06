import { describe, it, expect } from "vitest";
import { parseGitHubRemoteUrl } from "../src/remote.js";

describe("parseGitHubRemoteUrl", () => {
  it("parses standard HTTPS URL with .git", () => {
    const res = parseGitHubRemoteUrl("https://github.com/liltaket/Orchlet.git");
    expect(res).toEqual({ owner: "liltaket", repo: "Orchlet" });
  });

  it("parses standard HTTPS URL without .git", () => {
    const res = parseGitHubRemoteUrl("https://github.com/facebook/react");
    expect(res).toEqual({ owner: "facebook", repo: "react" });
  });

  it("parses HTTPS URL with token/credentials", () => {
    const res = parseGitHubRemoteUrl("https://x-access-token:ghp_12345@github.com/owner-org/repo-sub.git");
    expect(res).toEqual({ owner: "owner-org", repo: "repo-sub" });
  });

  it("parses standard SSH URL with .git", () => {
    const res = parseGitHubRemoteUrl("git@github.com:liltaket/Orchlet.git");
    expect(res).toEqual({ owner: "liltaket", repo: "Orchlet" });
  });

  it("parses standard SSH URL without .git", () => {
    const res = parseGitHubRemoteUrl("git@github.com:torvalds/linux");
    expect(res).toEqual({ owner: "torvalds", repo: "linux" });
  });

  it("parses ssh:// protocol prefix", () => {
    const res = parseGitHubRemoteUrl("ssh://git@github.com/acme/project.git");
    expect(res).toEqual({ owner: "acme", repo: "project" });
  });

  it("throws for non-GitHub URLs", () => {
    expect(() => parseGitHubRemoteUrl("https://gitlab.com/group/project.git")).toThrow(
      /not a recognized GitHub repository/,
    );
  });

  it("throws for malformed strings", () => {
    expect(() => parseGitHubRemoteUrl("not-a-url")).toThrow(
      /not a recognized GitHub repository/,
    );
  });
});
