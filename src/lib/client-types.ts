// Frontend types — ported verbatim from demo2.0's src/app/page.tsx (lines 27-168).
// These describe the JSON shapes returned by the API routes in src/app/api/**, which were
// ported byte-for-byte from demo2.0, so these types still apply unchanged.

import { fmtAmount, fmtDate } from "./format";

export type Outcome = "success" | "partial" | "failed" | "no-answer" | null;
export type Status = "dispatching" | "queued" | "ringing" | "in-progress" | "completed" | "failed";

export interface TranscriptLine {
  who: "envoy" | "them";
  text: string;
}

export interface Call {
  id: string;
  contactBusiness: string;
  toNumber: string;
  objective: string;
  status: Status;
  outcome: Outcome;
  result: string | null;
  summary: string | null;
  durationSec: number | null;
  transcript: TranscriptLine[];
  recordingUrl: string | null;
  endedReason: string | null;
  voicemailScript: string | null;
  invoiceNumber: string | null;
  amountDue?: number | null;
  currency?: string | null;
  invoices?: LinkedInvoice[];
  createdAt: string;
}

/** An invoice aggregated into a call (returned by GET /api/calls/[id]). */
export interface LinkedInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amountDue: number | null;
  currency: string | null;
  status: string;
}

/** An invoice sitting in the scheduling queue (returned by GET /api/invoices). */
export interface QueuedInvoice {
  id: string;
  contactBusiness: string;
  abn: string | null;
  groupKey: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amountDue: number | null;
  currency: string | null;
  status: string;
  attempts: number;
  chaseAfter: string;
  toNumber: string | null;
  call: { id: string; status: string; outcome: string | null } | null;
  contactPerson: string | null;
  userName: string;
  lineItems: string | null;
  invoiceNotes: string | null;
  bankName: string | null;
  bsb: string | null;
  accountNumber: string | null;
  swiftCode: string | null;
  remittanceName: string | null;
  remittanceContact: string | null;
  voice: string;
  manner: string;
  objective: string;
}

export interface SchedulerSettings {
  bhStartHour: number;
  bhEndHour: number;
  bhDays: string;
  timezone: string;
  dueOffsetDays: number;
  sortField: "overdue" | "amount";
  sortDir: "asc" | "desc";
  schedulerOn: boolean;
  smsEnabled: boolean;
  retryDelayHours: number;
  autoRetry: boolean;
}

export interface InvoiceParseResult {
  vendorName?: string | null;
  contactBusiness: string | null;
  contactPerson?: string | null;
  toNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amountDue: number | null;
  currency: string | null;
  lineItems: string | null;
  invoiceNotes: string | null;
  bankName?: string | null;
  bsb?: string | null;
  accountNumber?: string | null;
  swiftCode?: string | null;
  abn?: string | null;
  remittanceName?: string | null;
  remittanceContact?: string | null;
}

export type BulkStatus =
  | "parsing"
  | "parsed"
  | "parse-error"
  | "paused"
  | "dispatching"
  | "dispatched"
  | "dispatch-error"
  | "queueing"
  | "queued";
export type BulkSource = "upload" | "storage";

/** A PDF stored in the Supabase Storage invoices bucket (GET /api/files/invoices). */
export interface StoredFile {
  path: string;
  name: string;
  size: number | null;
  modifiedTime: string;
}

export interface ContactRow {
  businessName: string;
  abn: string | null;
  phone: string | null;
  email: string | null;
  contactPerson: string | null;
}

export interface BulkItem {
  uid: string;
  source: BulkSource;
  file?: File;
  storagePath?: string;
  fileName: string;
  fileSize?: number | null;
  modifiedTime?: string;
  status: BulkStatus;
  error?: string;
  parsed?: InvoiceParseResult;
  phoneSource?: "spreadsheet" | "pdf" | "none";
  callId?: string;
  callStatus?: Status;
  callOutcome?: Outcome;
  callPollError?: string | null;
}

/** Editable form state shared by InvoiceCompose and the bulk/queue edit drawers. */
export interface BulkFormState {
  contactBusiness: string;
  contactPerson: string;
  vendorName: string;
  toNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amountDue: string;
  currency: string;
  lineItems: string;
  invoiceNotes: string;
  bankName: string;
  bsb: string;
  accountNumber: string;
  swiftCode: string;
  abn: string;
  remittanceName: string;
  remittanceContact: string;
}

export function outcomeStyleClass(o: Outcome): { cls: string; label: string } {
  if (o === "success") return { cls: "bg-emerald-100 text-emerald-700", label: "Resolved" };
  if (o === "partial") return { cls: "bg-amber-100 text-amber-700", label: "Partial" };
  if (o === "no-answer") return { cls: "bg-slate-100 text-slate-500", label: "No answer" };
  if (o === "failed") return { cls: "bg-red-100 text-red-700", label: "Failed" };
  return { cls: "bg-slate-100 text-slate-400", label: "—" };
}

export function statusLabel(s: Status | string): string {
  if (s === "dispatching") return "Dispatching";
  if (s === "queued") return "Connecting";
  if (s === "ringing") return "Ringing";
  if (s === "in-progress") return "In conversation";
  if (s === "completed") return "Completed";
  if (s === "failed") return "Failed";
  return s;
}

export function generateInvoiceObjective(parsed: InvoiceParseResult): string {
  const parts: string[] = ["Follow up on payment for invoice"];
  if (parsed.invoiceNumber) parts.push(parsed.invoiceNumber);
  if (parsed.amountDue != null) {
    parts.push(`(${fmtAmount(parsed.currency, parsed.amountDue)} outstanding)`);
  }
  if (parsed.dueDate) parts.push(`— due ${fmtDate(parsed.dueDate)}`);
  parts.push(". Confirm whether payment has been made or is scheduled. If overdue, politely arrange a settlement date or payment plan.");
  return parts.join(" ");
}

export function buildBulkBrief(parsed: InvoiceParseResult, sourceFilePath?: string): Record<string, unknown> {
  return {
    contactBusiness: parsed.contactBusiness || "Accounts Payable",
    contactPerson: parsed.contactPerson ?? undefined,
    toNumber: parsed.toNumber!,
    objective: generateInvoiceObjective(parsed),
    voice: "iris",
    manner: "warm",
    userName: parsed.vendorName || "the caller",
    invoiceNumber: parsed.invoiceNumber ?? undefined,
    invoiceDate: parsed.invoiceDate ?? undefined,
    dueDate: parsed.dueDate ?? undefined,
    amountDue: parsed.amountDue ?? undefined,
    currency: parsed.currency ?? undefined,
    lineItems: parsed.lineItems ?? undefined,
    invoiceNotes: parsed.invoiceNotes ?? undefined,
    bankName: parsed.bankName ?? undefined,
    bsb: parsed.bsb ?? undefined,
    accountNumber: parsed.accountNumber ?? undefined,
    swiftCode: parsed.swiftCode ?? undefined,
    abn: parsed.abn ?? undefined,
    remittanceName: parsed.remittanceName ?? undefined,
    remittanceContact: parsed.remittanceContact ?? undefined,
    sourceFilePath: sourceFilePath ?? undefined,
  };
}
