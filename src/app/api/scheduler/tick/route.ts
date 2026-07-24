import { NextRequest, NextResponse } from "next/server";
import { runSchedulerTick } from "@/lib/dispatcher";
import { resolveAccess, hasRole, unauthorized, forbidden } from "@/lib/access";

/**
 * Manually run one scheduler tick for the signed-in tenant (the "Run now" button on
 * the Queue screen). Pass ?force=1 to bypass the business-hours gate (testing/demos).
 */
export async function POST(req: NextRequest) {
  const access = await resolveAccess();
  if (!access) return unauthorized();
  if (!hasRole(access, "agent")) return forbidden();

  const force = req.nextUrl.searchParams.get("force") === "1";
  const res = await runSchedulerTick(access.ownerId, { ignoreBusinessHours: force });
  return NextResponse.json(res);
}
