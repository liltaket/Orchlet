import { describe, it, expect, beforeEach } from "vitest";
import { AuthManager } from "../src/auth.js";
import { createServer } from "../src/server.js";

describe("WebSocket Ticket Security & Auth Gates", () => {
  let token: string;

  beforeEach(async () => {
    process.env.ORCHLET_AUTH_TOKEN = "test-secret-token-for-testing-12345";
    token = await AuthManager.getOrCreateToken();
  });

  it("unauthenticated user cannot request a WS ticket", async () => {
    const server = await createServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/ws-ticket",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("Unauthorized");
    await server.close();
  });

  it("valid bearer token can request a ticket", async () => {
    const server = await createServer();
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/ws-ticket",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ticket).toBeDefined();
    expect(body.ticket.startsWith("wst_")).toBe(true);
    expect(body.expiresInSeconds).toBe(60);
    await server.close();
  });

  it("ticket is single-use (second validation fails)", () => {
    const ticket = AuthManager.createWsTicket();
    expect(AuthManager.validateAndConsumeWsTicket(ticket)).toBe(true);
    // Second use must fail
    expect(AuthManager.validateAndConsumeWsTicket(ticket)).toBe(false);
  });

  it("random / forged ticket fails immediately", () => {
    expect(AuthManager.validateAndConsumeWsTicket("wst_nonexistent_forged_ticket")).toBe(false);
    expect(AuthManager.validateAndConsumeWsTicket("")).toBe(false);
    expect(AuthManager.validateAndConsumeWsTicket(undefined)).toBe(false);
  });

  it("expired ticket fails validation", async () => {
    // Create ticket valid for only 10ms
    const ticket = AuthManager.createWsTicket(10);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(AuthManager.validateAndConsumeWsTicket(ticket)).toBe(false);
  });

  it("permanent bearer token in query parameter is rejected by default", async () => {
    delete process.env.ORCHLET_ALLOW_LEGACY_QUERY_TOKEN;
    const server = await createServer();
    const res = await server.inject({
      method: "GET",
      url: `/api/tasks?token=${token}`,
    });

    expect(res.statusCode).toBe(401);
    await server.close();
  });

  it("permanent bearer token in query parameter is accepted ONLY when explicit legacy setting is enabled", async () => {
    process.env.ORCHLET_ALLOW_LEGACY_QUERY_TOKEN = "true";
    try {
      const server = await createServer();
      const res = await server.inject({
        method: "GET",
        url: `/api/tasks?token=${token}`,
      });

      expect(res.statusCode).toBe(200);
      await server.close();
    } finally {
      delete process.env.ORCHLET_ALLOW_LEGACY_QUERY_TOKEN;
    }
  });
});
