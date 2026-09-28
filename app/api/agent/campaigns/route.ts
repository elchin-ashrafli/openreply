import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db/client";
import { getPrimaryWorkspace } from "@/lib/workspace";
import { createCampaign } from "@/lib/campaigns/create";

/**
 * Agent campaigns — lets a trusted script list and create campaigns.
 *
 * Deliberately narrow: AGENT_API_TOKEN buys these two actions in the workspace
 * of AGENT_USER_EMAIL and nothing else — no session, no inbox, no settings, no
 * connected accounts. A leaked token can at worst add a campaign. Creation
 * runs the same shared logic as the dashboard, validation included.
 *
 * Off unless AGENT_API_TOKEN is set; it answers 404 then, so an instance that
 * does not use it does not advertise it.
 */

export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = Buffer.from(process.env.AGENT_API_TOKEN ?? "");
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  return given.length === secret.length && timingSafeEqual(given, secret);
}

type Gate = { workspaceId: string } | { response: NextResponse };

async function gate(request: NextRequest): Promise<Gate> {
  if (!process.env.AGENT_API_TOKEN) {
    return { response: NextResponse.json({ success: false, error: "Not found" }, { status: 404 }) };
  }
  if (!authorized(request)) {
    return { response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  const email = (process.env.AGENT_USER_EMAIL ?? "").trim().toLowerCase();
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true } })
    : null;
  const workspace = user ? await getPrimaryWorkspace(user.id) : null;
  if (!workspace) {
    // The user and workspace appear on first sign-in, so the owner signs in once.
    return {
      response: NextResponse.json(
        { success: false, error: "AGENT_USER_EMAIL has no workspace yet" },
        { status: 404 },
      ),
    };
  }
  return { workspaceId: workspace.id };
}

export async function GET(request: NextRequest) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  const data = await prisma.automation.findMany({
    where: { workspaceId: g.workspaceId },
    select: { id: true, name: true, postId: true, keywords: true, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ success: true, data });
}

export async function POST(request: NextRequest) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  const body = await request.json().catch(() => ({}));
  const result = await createCampaign(g.workspaceId, body);
  return NextResponse.json(result.body, { status: result.status });
}
