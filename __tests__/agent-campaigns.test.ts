/**
 * Agent campaigns — Unit Tests
 *
 * A script holding AGENT_API_TOKEN may list and create campaigns, and nothing
 * else: no session, no access to the inbox, settings or connected accounts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() }, automation: { findMany: vi.fn() } },
  getPrimaryWorkspace: vi.fn(),
  createCampaign: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/workspace", () => ({ getPrimaryWorkspace: mocks.getPrimaryWorkspace }));
vi.mock("@/lib/campaigns/create", () => ({ createCampaign: mocks.createCampaign }));

import { GET, POST } from "../app/api/agent/campaigns/route";

const TOKEN = "agent-token-of-reasonable-length";

function req(method: string, token?: string, body?: unknown) {
  return new NextRequest("https://app.test/api/agent/campaigns", {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("AGENT_API_TOKEN", TOKEN);
  vi.stubEnv("AGENT_USER_EMAIL", "Owner@Example.com");
  for (const fn of [mocks.prisma.user.findUnique, mocks.prisma.automation.findMany,
    mocks.getPrimaryWorkspace, mocks.createCampaign]) fn.mockReset();
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "user_1" });
  mocks.getPrimaryWorkspace.mockResolvedValue({ id: "ws_1" });
});

describe("auth", () => {
  it("is disabled entirely when AGENT_API_TOKEN is unset", async () => {
    vi.stubEnv("AGENT_API_TOKEN", "");
    expect((await POST(req("POST", "anything", { name: "x" }))).status).toBe(404);
    expect((await GET(req("GET", "anything"))).status).toBe(404);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong token", async () => {
    expect((await POST(req("POST", undefined, { name: "x" }))).status).toBe(401);
    expect((await POST(req("POST", "wrong", { name: "x" }))).status).toBe(401);
    expect((await GET(req("GET", "wrong"))).status).toBe(401);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    expect(mocks.prisma.automation.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the configured user has no workspace yet", async () => {
    mocks.getPrimaryWorkspace.mockResolvedValue(null);
    expect((await POST(req("POST", TOKEN, { name: "x" }))).status).toBe(404);
  });
});

describe("POST", () => {
  it("creates the campaign through the shared logic, in the user's workspace", async () => {
    mocks.createCampaign.mockResolvedValue({ status: 201, body: { success: true, data: { id: "a1" } } });
    const payload = { name: "MERSIN", keywords: ["MERSIN"], dmMessage: "hi", postId: "p1" };

    const res = await POST(req("POST", TOKEN, payload));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: { id: "a1" } });
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "owner@example.com" }, select: { id: true },
    });
    expect(mocks.createCampaign).toHaveBeenCalledWith("ws_1", payload);
  });

  it("passes validation failures through unchanged", async () => {
    mocks.createCampaign.mockResolvedValue({ status: 400, body: { success: false, error: "Invalid input" } });
    const res = await POST(req("POST", TOKEN, {}));
    expect(res.status).toBe(400);
  });
});

describe("GET", () => {
  it("lists the workspace's campaigns with only the fields a launcher needs", async () => {
    mocks.prisma.automation.findMany.mockResolvedValue([
      { id: "a1", name: "ALTEA", postId: "p1", keywords: ["ALTEA"], isActive: true },
    ]);
    const res = await GET(req("GET", TOKEN));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    expect(mocks.prisma.automation.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws_1" },
      select: { id: true, name: true, postId: true, keywords: true, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  });
});
