import { NextRequest, NextResponse } from "next/server";
import { runAllTenantsTick } from "@/lib/dispatcher";

// On-demand, multi-tenant dispatch tick. This is what an external scheduler
// (Vercel Cron / cron-job.org) hits on a serverless host that can't run the always-on
// scripts/scheduler.ts worker. Unauthenticated by session (it's in middleware's
// PUBLIC_ROUTES) — instead it's guarded by a shared secret in the Authorization header.
//
// Wire up externally, e.g. vercel.json:
//   { "crons": [{ "path": "/api/cron/dispatch", "schedule": "* * * * *" }] }
// (Vercel Cron sends the CRON_SECRET automatically only if configured; otherwise use
// cron-job.org with an `Authorization: Bearer <CRON_SECRET>` header.)
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  // Vercel Cron sends its own header; also accept ?token= for schedulers that can't set headers.
  const token = bearer ?? req.nextUrl.searchParams.get("token");
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const res = await runAllTenantsTick({ ignoreBusinessHours: force });
  return NextResponse.json(res);
}
