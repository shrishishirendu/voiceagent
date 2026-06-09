import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/dispatcher";

/** Read / update the singleton scheduler Settings row. */

export async function GET() {
  return NextResponse.json(await getSettings());
}

const SettingsSchema = z.object({
  bhStartHour: z.number().int().min(0).max(23).optional(),
  bhEndHour: z.number().int().min(1).max(24).optional(),
  bhDays: z.string().regex(/^[1-7](,[1-7])*$/, "Comma-separated ISO weekdays 1-7").optional(),
  timezone: z.string().min(1).max(64).optional(),
  dueOffsetDays: z.number().int().min(-365).max(365).optional(),
  sortField: z.enum(["overdue", "amount"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  schedulerOn: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settings", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (parsed.data.bhStartHour != null && parsed.data.bhEndHour != null && parsed.data.bhEndHour <= parsed.data.bhStartHour) {
    return NextResponse.json({ error: "bhEndHour must be after bhStartHour" }, { status: 400 });
  }

  const updated = await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...parsed.data },
    update: parsed.data,
  });
  return NextResponse.json(updated);
}
