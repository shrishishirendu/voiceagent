import { NextRequest, NextResponse } from "next/server";
import { runSchedulerTick } from "@/lib/dispatcher";

/**
 * Manually run one scheduler tick (the "Run now" button on the Queue screen).
 * Pass ?force=1 to bypass the business-hours gate (useful for testing/demos).
 */
export async function POST(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  const res = await runSchedulerTick({ ignoreBusinessHours: force });
  return NextResponse.json(res);
}
