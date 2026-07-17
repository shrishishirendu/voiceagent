// Client-side formatting helpers — ported verbatim from demo2.0's src/app/page.tsx (lines 172-261).

export function fmtDuration(s: number | null | undefined): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtAmount(currency: string | null | undefined, amount: number | null | undefined): string {
  if (amount == null) return "";
  const n = amount.toLocaleString("en-AU", { maximumFractionDigits: 2 });
  const c = (currency ?? "").trim().toUpperCase();
  if (c === "" || c === "AUD" || c === "$" || c === "A$" || c === "AU$") return `$${n}`;
  return `${c} ${n}`;
}

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const s = dateStr.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const mi = parseInt(iso[2], 10) - 1;
    if (mi < 0 || mi > 11) return s;
    return `${parseInt(iso[3], 10)} ${months[mi]} ${iso[1]}`;
  }
  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slashDate) {
    const d1 = parseInt(slashDate[1], 10), d2 = parseInt(slashDate[2], 10), yr = slashDate[3];
    const miAU = d2 - 1;
    if (miAU >= 0 && miAU <= 11) return `${d1} ${months[miAU]} ${yr}`;
    const miUS = d1 - 1;
    if (miUS >= 0 && miUS <= 11) return `${d2} ${months[miUS]} ${yr}`;
    return s;
  }
  const longMDY = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (longMDY) {
    const mi = monthIndex[longMDY[1].toLowerCase()];
    if (mi !== undefined) return `${parseInt(longMDY[2], 10)} ${months[mi]} ${longMDY[3]}`;
  }
  const longDMY = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (longDMY) {
    const mi = monthIndex[longDMY[2].toLowerCase()];
    if (mi !== undefined) return `${parseInt(longDMY[1], 10)} ${months[mi]} ${longDMY[3]}`;
  }
  return s;
}

export const PHONE_MIN_DIGITS = 9;
export const CONCURRENT_CALL_LIMIT = 5;

export function phoneDigitCount(value: string | null | undefined): number {
  return value?.replace(/\D/g, "").length ?? 0;
}

export function hasCallableNumber(value: string | null | undefined): boolean {
  return phoneDigitCount(value) >= PHONE_MIN_DIGITS;
}

export function createSemaphore(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function acquire<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
