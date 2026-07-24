import { fmtAmount, isDollarCurrency, parseDateFlexible } from "@/lib/format";

// Multi-currency money handling. Invoices may carry different currencies (intentional test
// data), so we never sum across currencies — amounts are bucketed per currency and rendered
// explicitly (e.g. "$12,340.00 + USD 4,459.88").

export type MoneyByCurrency = { currency: string; amount: number }[];

// Normalise a raw currency string to a canonical bucket key. All the "$"-style currencies
// collapse to a single "AUD" bucket (matching fmtAmount's dollar rules); anything else keys
// by its uppercased code.
export function currencyKey(currency: string | null | undefined): string {
  return isDollarCurrency(currency) ? "AUD" : (currency ?? "").trim().toUpperCase();
}

type OutstandingInvoice = {
  amountDue: number | null;
  paidAmount?: number | null;
  currency: string | null;
  dueDate: string | null;
  status: string;
};

// An invoice is outstanding when it is not cancelled, not fully paid, and past its due date.
// A missing/unparseable due date is treated as outstanding — unpaid money with an unknown due
// date can't be proven to be upcoming.
export function isOutstanding(inv: OutstandingInvoice, now: Date = new Date()): boolean {
  if (inv.status === "cancelled") return false;
  const amount = inv.amountDue ?? 0;
  const paid = inv.paidAmount ?? 0;
  if (paid >= amount) return false;
  const due = parseDateFlexible(inv.dueDate);
  if (!due) return true; // unknown due date → treat as owed
  return due.getTime() <= now.getTime();
}

// The unpaid remainder of a single invoice.
export function outstandingRemainder(inv: OutstandingInvoice): number {
  return Math.max(0, (inv.amountDue ?? 0) - (inv.paidAmount ?? 0));
}

// Sum the outstanding remainder of the given invoices, bucketed per currency. Only invoices
// that pass isOutstanding are counted. Buckets are returned largest-first.
export function sumOutstandingByCurrency(invoices: OutstandingInvoice[], now: Date = new Date()): MoneyByCurrency {
  const buckets = new Map<string, number>();
  for (const inv of invoices) {
    if (!isOutstanding(inv, now)) continue;
    const key = currencyKey(inv.currency);
    buckets.set(key, (buckets.get(key) ?? 0) + outstandingRemainder(inv));
  }
  return Array.from(buckets.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// Merge several per-currency bucket lists into one (e.g. a grand total across customers).
export function mergeMoney(lists: MoneyByCurrency[]): MoneyByCurrency {
  const buckets = new Map<string, number>();
  for (const list of lists) {
    for (const b of list) buckets.set(b.currency, (buckets.get(b.currency) ?? 0) + b.amount);
  }
  return Array.from(buckets.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// Total money across all buckets ignoring currency — only for emptiness checks / sizing, never
// for display (mixing currencies in one number is exactly what we avoid showing users).
export function totalMoneyMagnitude(buckets: MoneyByCurrency): number {
  return buckets.reduce((s, b) => s + b.amount, 0);
}

// Sum raw amounts per currency (no outstanding/past-due filtering) — for a group total (e.g.
// the dispatch queue) that must never merge different currencies under one symbol.
export function sumAmountsByCurrency(items: { amountDue: number | null; currency: string | null }[]): MoneyByCurrency {
  const buckets = new Map<string, number>();
  for (const i of items) {
    if (i.amountDue == null) continue;
    const key = currencyKey(i.currency);
    buckets.set(key, (buckets.get(key) ?? 0) + i.amountDue);
  }
  return Array.from(buckets.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// Render per-currency buckets as one explicit string, e.g. "$12,340.00 + USD 4,459.88".
// Empty → "$0". The "AUD" bucket renders as a bare "$" via fmtAmount.
export function fmtMoneyByCurrency(buckets: MoneyByCurrency): string {
  if (!buckets.length) return "$0";
  return buckets.map((b) => fmtAmount(b.currency === "AUD" ? null : b.currency, b.amount)).join(" + ");
}
