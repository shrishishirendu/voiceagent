/**
 * Standalone scheduler worker.
 *
 * Runs decoupled from Next (`npm run scheduler`). Every minute it asks the shared
 * dispatcher to run one tick: within business hours, it groups eligible invoices
 * by debtor, orders them per Settings, and dispatches up to the free call slots.
 *
 * Business hours, due-date offset, ordering and on/off live in the singleton
 * Settings row and can be changed at runtime from the UI — no restart needed.
 */

import "dotenv/config";
import cron from "node-cron";
import { runSchedulerTick } from "@/lib/dispatcher";
import { prisma } from "@/lib/prisma";

// Default: every minute. Override with SCHEDULER_CRON (standard cron syntax).
const TICK_CRON = process.env.SCHEDULER_CRON ?? "* * * * *";

let running = false; // guard against overlapping ticks if one runs long

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const res = await runSchedulerTick();
    // Stay quiet on idle ticks; only log when something happened or went wrong.
    if (res.dispatched > 0 || res.errors?.length) {
      console.log(
        `[scheduler] ${new Date().toISOString()} dispatched=${res.dispatched}` +
          (res.reason ? ` reason="${res.reason}"` : "") +
          (res.errors ? ` errors="${res.errors.join("; ")}"` : "")
      );
    }
  } catch (err) {
    console.error("[scheduler] tick error:", err);
  } finally {
    running = false;
  }
}

console.log(`[scheduler] starting; cron="${TICK_CRON}"`);
cron.schedule(TICK_CRON, tick);
// Fire once immediately so a fresh start doesn't wait a full minute.
void tick();

async function shutdown(): Promise<void> {
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
