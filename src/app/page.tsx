"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { companyNamesMatch } from "@/lib/nameUtils";

// ─── Constants ──────────────────────────────────────────────────────────

const CONCURRENT_CALL_LIMIT = 5;
const PHONE_MIN_DIGITS = 9;

function createSemaphore(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function acquire<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active++;
    try { return await fn(); }
    finally { active--; queue.shift()?.(); }
  };
}

const phoneDigitCount = (value: string | null | undefined) => value?.replace(/\D/g, "").length ?? 0;
const hasCallableNumber = (value: string | null | undefined) => phoneDigitCount(value) >= PHONE_MIN_DIGITS;

// ─── Types ──────────────────────────────────────────────────────────────

type Outcome = "success" | "partial" | "failed" | "no-answer" | null;
type Status = "dispatching" | "queued" | "ringing" | "in-progress" | "completed" | "failed";

interface TranscriptLine {
  who: "envoy" | "them";
  text: string;
}

interface Call {
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
  invoiceNumber: string | null;
  createdAt: string;
}

interface InvoiceParseResult {
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

type BulkStatus = "parsing" | "parsed" | "parse-error" | "paused" | "dispatching" | "dispatched" | "dispatch-error";
type BulkSource = "upload" | "drive";

interface DriveInvoiceFile {
  fileId: string;
  name: string;
  size: number | null;
  modifiedTime: string;
}

interface ContactRow {
  businessName: string;
  abn: string | null;
  phone: string | null;
  email: string | null;
  contactPerson: string | null;
}

interface BulkItem {
  uid: string;
  source: BulkSource;
  file?: File;            // upload items only
  driveFileId?: string;   // drive items only
  fileName: string;       // unified display name
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

// ─── Helpers ────────────────────────────────────────────────────────────

const fmtDuration = (s: number | null | undefined) => {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const fmtBytes = (n: number | null | undefined) => {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const fmtAmount = (currency: string | null | undefined, amount: number | null | undefined): string => {
  if (amount == null) return "";
  // Thousands separators; show up to 2 decimals but don't force trailing zeros (200 → "200", 577271.99 → "577,271.99").
  const n = amount.toLocaleString("en-AU", { maximumFractionDigits: 2 });
  const c = (currency ?? "").trim().toUpperCase();
  if (c === "" || c === "AUD" || c === "$" || c === "A$" || c === "AU$") return `$${n}`;
  return `${c} ${n}`;
};

const fmtDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthIndex: Record<string, number> = {
    january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,
    jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  };
  const s = dateStr.trim();
  // YYYY-MM-DD
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const mi = parseInt(iso[2], 10) - 1;
    if (mi < 0 || mi > 11) return s;
    return `${parseInt(iso[3], 10)} ${months[mi]} ${iso[1]}`;
  }
  // slash-separated: try D/M/YYYY (AU) first; if month field > 12 assume M/D/YYYY (US)
  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slashDate) {
    const d1 = parseInt(slashDate[1], 10), d2 = parseInt(slashDate[2], 10), yr = slashDate[3];
    const miAU = d2 - 1; // D/M/YYYY → month is second group
    if (miAU >= 0 && miAU <= 11) return `${d1} ${months[miAU]} ${yr}`;
    const miUS = d1 - 1; // M/D/YYYY → month is first group
    if (miUS >= 0 && miUS <= 11) return `${d2} ${months[miUS]} ${yr}`;
    return s;
  }
  // "Month D, YYYY" or "Month D YYYY" (e.g. "April 15, 2026")
  const longMDY = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (longMDY) {
    const mi = monthIndex[longMDY[1].toLowerCase()];
    if (mi !== undefined) return `${parseInt(longMDY[2], 10)} ${months[mi]} ${longMDY[3]}`;
  }
  // "D Month YYYY" (e.g. "31 May 2026") — already our target format, pass through
  const longDMY = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (longDMY) {
    const mi = monthIndex[longDMY[2].toLowerCase()];
    if (mi !== undefined) return `${parseInt(longDMY[1], 10)} ${months[mi]} ${longDMY[3]}`;
  }
  return s;
};

const outcomeStyle = (o: Outcome) => {
  if (o === "success") return { bg: "var(--success-tint)", fg: "var(--success)", label: "Resolved" };
  if (o === "partial") return { bg: "var(--warning-tint)", fg: "var(--warning)", label: "Partial" };
  if (o === "no-answer") return { bg: "var(--burgundy-tint)", fg: "var(--burgundy)", label: "No answer" };
  if (o === "failed") return { bg: "var(--burgundy-tint)", fg: "var(--burgundy)", label: "Failed" };
  return { bg: "var(--cream-dark)", fg: "var(--muted)", label: "—" };
};

const statusLabel = (s: Status) => {
  if (s === "dispatching") return "Dispatching";
  if (s === "queued") return "Connecting";
  if (s === "ringing") return "Ringing";
  if (s === "in-progress") return "In conversation";
  if (s === "completed") return "Completed";
  if (s === "failed") return "Failed";
  return s;
};

const generateInvoiceObjective = (parsed: InvoiceParseResult): string => {
  const parts: string[] = ["Follow up on payment for invoice"];
  if (parsed.invoiceNumber) parts.push(parsed.invoiceNumber);
  if (parsed.amountDue != null) {
    parts.push(`(${fmtAmount(parsed.currency, parsed.amountDue)} outstanding)`);
  }
  if (parsed.dueDate) parts.push(`— due ${fmtDate(parsed.dueDate)}`);
  parts.push(". Confirm whether payment has been made or is scheduled. If overdue, politely arrange a settlement date or payment plan.");
  return parts.join(" ");
};

const buildBulkBrief = (parsed: InvoiceParseResult): Record<string, unknown> => ({
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
});

// ─── Shared bits ────────────────────────────────────────────────────────

const Hairline = ({ className = "" }: { className?: string }) => (
  <div className={`h-px w-full ${className}`} style={{ background: "var(--hairline)" }} />
);

const Brand = ({ size = "md" }: { size?: "md" | "lg" }) => (
  <div className="flex items-center gap-2.5">
    <svg width={size === "lg" ? 28 : 22} height={size === "lg" ? 28 : 22} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="11" stroke="var(--ink)" strokeWidth="1.2" />
    </svg>
    <span className="font-display font-medium text-[1.05rem] tracking-tight" style={{ color: "var(--ink)" }}>
      Envoy
    </span>
  </div>
);

const WaveAnim = ({ active }: { active: boolean }) => (
  <div className="flex items-center gap-[3px] h-5">
    {[0, 1, 2, 3, 4].map((i) => (
      <div
        key={i}
        className={active ? "wave-bar" : ""}
        style={{
          width: 2.5,
          height: "100%",
          background: "var(--burgundy)",
          borderRadius: 2,
          animationDelay: `${i * 0.12}s`,
          opacity: active ? 1 : 0.3,
        }}
      />
    ))}
  </div>
);

// ─── Home ───────────────────────────────────────────────────────────────

function Home({
  calls,
  loading,
  onNewCall,
  onUploadInvoice,
  onSelectCall,
  onRefresh,
}: {
  calls: Call[];
  loading: boolean;
  onNewCall: () => void;
  onUploadInvoice: () => void;
  onSelectCall: (id: string) => void;
  onRefresh: () => void;
}) {
  const resolved = calls.filter((c) => c.outcome === "success").length;
  const failed = calls.filter((c) => c.outcome === "failed").length;

  return (
    <div className="min-h-screen pb-32 fade-in">
      <header className="px-6 pt-12 pb-7">
        <div className="flex items-center justify-between mb-10">
          <Brand size="lg" />
          <button
            onClick={onRefresh}
            className="w-9 h-9 rounded-full flex items-center justify-center border"
            style={{ background: "var(--cream-light)", borderColor: "var(--hairline)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>

        <h1 className="font-display text-[2.6rem] leading-[1.05] font-light tracking-tight">
          {calls.length === 0 ? (
            <>Place your<br/><span className="italic font-normal" style={{ color: "var(--burgundy)" }}>first call.</span></>
          ) : (
            <>{calls.length} {calls.length === 1 ? "call" : "calls"}<br/><span className="italic font-normal" style={{ color: "var(--burgundy)" }}>so far.</span></>
          )}
        </h1>
      </header>

      <Hairline />

      <div className="grid grid-cols-2 px-6 py-3" style={{ borderBottom: "1px solid var(--hairline)" }}>
        <div>
          <div className="font-display text-[1.75rem] leading-none font-medium">{resolved}</div>
          <div className="smallcaps mt-1.5" style={{ color: "var(--muted)" }}>Resolved</div>
        </div>
        <div className="border-l pl-4" style={{ borderColor: "var(--hairline)" }}>
          <div className="font-display text-[1.75rem] leading-none font-medium">{failed}</div>
          <div className="smallcaps mt-1.5" style={{ color: "var(--muted)" }}>Failed</div>
        </div>
      </div>

      {calls.length === 0 && !loading && (
        <div className="px-6 py-20 text-center">
          <p className="font-display text-[1.2rem] italic mb-3" style={{ color: "var(--muted)" }}>
            Nothing here yet.
          </p>
          <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Tap below to dispatch your first call.
          </p>
        </div>
      )}

      <div>
        {calls.map((call, i) => {
          const oc = outcomeStyle(call.outcome);
          const active = call.status !== "completed" && call.status !== "failed";
          return (
            <button
              key={call.id}
              onClick={() => onSelectCall(call.id)}
              className="w-full text-left px-6 py-5 transition fade-up"
              style={{
                borderBottom: "1px solid var(--hairline)",
                animationDelay: `${i * 60}ms`,
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[0.7rem]" style={{ color: "var(--muted)" }}>
                      {fmtWhen(call.createdAt)}
                    </span>
                    <span style={{ color: "var(--hairline-strong)" }}>·</span>
                    <span className="font-mono text-[0.7rem]" style={{ color: "var(--muted)" }}>
                      {fmtDuration(call.durationSec)}
                    </span>
                  </div>
                  <h3 className="font-display text-[1.2rem] leading-tight font-medium tracking-tight">
                    {call.contactBusiness}
                  </h3>
                </div>
                {active ? (
                  <span className="smallcaps px-2 py-1 rounded-sm dot-pulse" style={{ background: "var(--burgundy-tint)", color: "var(--burgundy)" }}>
                    {statusLabel(call.status)}
                  </span>
                ) : (
                  <span className="smallcaps px-2 py-1 rounded-sm whitespace-nowrap" style={{ background: oc.bg, color: oc.fg }}>
                    {oc.label}
                  </span>
                )}
              </div>
              <p className="text-[0.92rem] leading-snug" style={{ color: "var(--muted)" }}>
                {call.result ?? call.objective}
              </p>
            </button>
          );
        })}
      </div>

      <div className="px-6 py-8 text-center">
        <p className="smallcaps" style={{ color: "var(--muted-light)" }}>End of history</p>
      </div>

      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-5 pb-7 pt-14"
        style={{ background: "linear-gradient(to top, var(--cream) 60%, transparent)" }}
      >
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onNewCall}
            className="w-full py-4 rounded-full flex items-center justify-center gap-2.5 font-medium text-[1rem] transition active:scale-[0.98]"
            style={{ background: "var(--ink)", color: "var(--cream)", letterSpacing: "-0.01em" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            Place a new call
          </button>
          <button
            onClick={onUploadInvoice}
            className="w-full py-4 rounded-full flex items-center justify-center gap-2.5 font-medium text-[1rem] transition active:scale-[0.98] border"
            style={{
              background: "var(--cream-light)",
              color: "var(--ink)",
              borderColor: "var(--hairline-strong)",
              letterSpacing: "-0.01em",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Select invoice
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Compose ────────────────────────────────────────────────────────────

function Compose({ onCancel, onPlace }: { onCancel: () => void; onPlace: (b: any) => Promise<void> }) {
  const [number, setNumber] = useState("+61 ");
  const [contact, setContact] = useState("");
  const [objective, setObjective] = useState("");
  const [voice, setVoice] = useState("iris");
  const [manner, setManner] = useState("warm");
  const [userName, setUserName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voices = [
    { id: "marcus", name: "Marcus", desc: "Steady, AU male" },
    { id: "iris", name: "Iris", desc: "Warm, AU female" },
    { id: "theo", name: "Theo", desc: "Crisp, UK male" },
  ];
  const manners = [
    { id: "warm", name: "Warm", desc: "Friendly, conversational" },
    { id: "crisp", name: "Crisp", desc: "Direct, time-efficient" },
    { id: "formal", name: "Formal", desc: "Professional, precise" },
  ];

  const phoneDigits = phoneDigitCount(number);
  const isValid = phoneDigits >= 9 && objective.trim().length > 9 && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onPlace({
        contactBusiness: contact || "Unknown contact",
        toNumber: number,
        objective,
        voice,
        manner,
        userName: userName || "the caller",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to dispatch");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pb-40 fade-in">
      <header className="px-6 pt-12 pb-6 flex items-center justify-between">
        <button onClick={onCancel} className="-ml-2 px-2 py-1.5 flex items-center gap-1 text-[0.92rem]" style={{ color: "var(--muted)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </header>

      <div className="px-6 mb-8">
        <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>New brief</p>
        <h1 className="font-display text-[2.2rem] leading-[1.05] font-light tracking-tight">
          Who should I call,<br/>
          <span className="italic" style={{ color: "var(--burgundy)" }}>and what for?</span>
        </h1>
      </div>

      <div className="px-6 space-y-7">
        <div>
          <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Number to call</label>
          <input
            type="tel"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+61 4..."
            className="w-full pb-3 font-mono text-[1.2rem] bg-transparent"
            style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
          />
        </div>

        <div>
          <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>
            Contact / business <span style={{ color: "var(--muted-light)" }}>· optional</span>
          </label>
          <input
            type="text"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="e.g. Joe at the plumbers"
            className="w-full pb-3 text-[1.05rem] bg-transparent"
            style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
          />
        </div>

        <div>
          <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>
            Your name / business <span style={{ color: "var(--muted-light)" }}>· how Envoy refers to you</span>
          </label>
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="e.g. Suresh"
            className="w-full pb-3 text-[1.05rem] bg-transparent"
            style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
          />
        </div>

        <div>
          <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Objective</label>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="What do you want Envoy to achieve? Be specific — dates, names, prices, alternatives."
            rows={4}
            className="w-full pb-3 text-[1.05rem] bg-transparent leading-relaxed resize-none"
            style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
          />
        </div>

        <div>
          <label className="smallcaps mb-3 block" style={{ color: "var(--muted)" }}>Voice</label>
          <div className="grid grid-cols-3 gap-2">
            {voices.map((v) => (
              <button
                key={v.id}
                onClick={() => setVoice(v.id)}
                className="text-left p-3 rounded-md border transition"
                style={{
                  borderColor: voice === v.id ? "var(--ink)" : "var(--hairline)",
                  background: voice === v.id ? "var(--ink)" : "var(--cream-light)",
                  color: voice === v.id ? "var(--cream)" : "var(--ink)",
                }}
              >
                <div className="font-display text-[0.95rem] font-medium leading-none mb-1">{v.name}</div>
                <div className="text-[0.7rem] leading-tight" style={{ opacity: voice === v.id ? 0.7 : 0.55 }}>{v.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="smallcaps mb-3 block" style={{ color: "var(--muted)" }}>Manner</label>
          <div className="grid grid-cols-3 gap-2">
            {manners.map((p) => (
              <button
                key={p.id}
                onClick={() => setManner(p.id)}
                className="text-left p-3 rounded-md border transition"
                style={{
                  borderColor: manner === p.id ? "var(--ink)" : "var(--hairline)",
                  background: manner === p.id ? "var(--ink)" : "var(--cream-light)",
                  color: manner === p.id ? "var(--cream)" : "var(--ink)",
                }}
              >
                <div className="font-display text-[0.95rem] font-medium leading-none mb-1">{p.name}</div>
                <div className="text-[0.7rem] leading-tight" style={{ opacity: manner === p.id ? 0.7 : 0.55 }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-md text-[0.9rem] leading-snug" style={{ background: "var(--burgundy-tint)", color: "var(--burgundy)" }}>
            <strong className="block mb-1">Dispatch failed</strong>
            {error}
          </div>
        )}
      </div>

      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-5 pb-7 pt-14"
        style={{ background: "linear-gradient(to top, var(--cream) 65%, transparent)" }}
      >
        <button
          disabled={!isValid}
          onClick={submit}
          className="w-full py-4 rounded-full flex items-center justify-center gap-2.5 font-medium text-[1rem] transition active:scale-[0.98]"
          style={{
            background: isValid ? "var(--burgundy)" : "var(--hairline-strong)",
            color: "var(--cream)",
            letterSpacing: "-0.01em",
            opacity: isValid ? 1 : 0.7,
          }}
        >
          {submitting ? "Dispatching…" : isValid ? "Dispatch Envoy" : "Fill the brief first"}
        </button>
        <p className="text-center mt-3 text-[0.72rem]" style={{ color: "var(--muted-light)" }}>
          The call is recorded. Envoy identifies itself as an AI agent.
        </p>
      </div>
    </div>
  );
}

type BulkFormState = {
  toNumber: string; contactBusiness: string; contactPerson: string; vendorName: string;
  invoiceNumber: string; invoiceDate: string; dueDate: string;
  amountDue: string; currency: string; lineItems: string; invoiceNotes: string;
  bankName: string; bsb: string; accountNumber: string; swiftCode: string;
  abn: string; remittanceName: string; remittanceContact: string;
};

function InvoiceCompose({
  onCancel,
  onPlace,
  preloaded,
  onBulkFiles,
  onBackWithState,
}: {
  onCancel: () => void;
  onPlace: (b: any) => Promise<void>;
  preloaded?: { parsed: InvoiceParseResult };
  onBulkFiles?: (files: File[]) => void;
  onBackWithState?: (state: BulkFormState) => void;
}) {
  const pre = preloaded?.parsed;
  const [stage, setStage] = useState<"upload" | "review">(pre ? "review" : "upload");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [number, setNumber] = useState(pre?.toNumber ?? "+61 ");
  const [contactBusiness, setContactBusiness] = useState(pre?.contactBusiness ?? "");
  const [contactPerson, setContactPerson] = useState(pre?.contactPerson ?? "");
  const [objective, setObjective] = useState(() => (pre ? generateInvoiceObjective(pre) : ""));
  const [voice, setVoice] = useState("iris");
  const [manner, setManner] = useState("warm");
  const [userName, setUserName] = useState(pre?.vendorName ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(pre?.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(pre?.invoiceDate ?? "");
  const [dueDate, setDueDate] = useState(pre?.dueDate ?? "");
  const [amountDue, setAmountDue] = useState(pre?.amountDue != null ? String(pre.amountDue) : "");
  const [currency, setCurrency] = useState(pre?.currency ?? "");
  const [lineItems, setLineItems] = useState(pre?.lineItems ?? "");
  const [invoiceNotes, setInvoiceNotes] = useState(pre?.invoiceNotes ?? "");
  const [bankName, setBankName] = useState(pre?.bankName ?? "");
  const [bsb, setBsb] = useState(pre?.bsb ?? "");
  const [accountNumber, setAccountNumber] = useState(pre?.accountNumber ?? "");
  const [swiftCode, setSwiftCode] = useState(pre?.swiftCode ?? "");
  const [abn, setAbn] = useState(pre?.abn ?? "");
  const [remittanceName, setRemittanceName] = useState(pre?.remittanceName ?? "");
  const [remittanceContact, setRemittanceContact] = useState(pre?.remittanceContact ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [phoneSource, setPhoneSource] = useState<"parsed" | "contacts" | "manual">(
    pre?.toNumber ? "parsed" : "manual"
  );

  const voices = [
    { id: "marcus", name: "Marcus", desc: "Steady, AU male" },
    { id: "iris", name: "Iris", desc: "Warm, AU female" },
    { id: "theo", name: "Theo", desc: "Crisp, UK male" },
  ];
  const manners = [
    { id: "warm", name: "Warm", desc: "Friendly, conversational" },
    { id: "crisp", name: "Crisp", desc: "Direct, time-efficient" },
    { id: "formal", name: "Formal", desc: "Professional, precise" },
  ];

  const phoneDigits = number.replace(/\D/g, "").length;
  const isValid = phoneDigits >= 9 && objective.trim().length > 9 && !submitting;

  const handleParseSuccess = async (parsed: InvoiceParseResult) => {
    const nextInvoiceNumber = parsed.invoiceNumber ?? "";
    const parsedToNumber = hasCallableNumber(parsed.toNumber) ? parsed.toNumber : null;
    const parsedContactBusiness =
      !parsedToNumber &&
      parsed.toNumber &&
      /[A-Za-z]/.test(parsed.toNumber) &&
      !parsed.toNumber.includes("@") &&
      (!parsed.contactBusiness ||
        parsed.contactBusiness.includes("@") ||
        (/^[A-Za-z0-9._-]+$/.test(parsed.contactBusiness) && parsed.contactBusiness.includes(".")))
        ? parsed.toNumber
        : parsed.contactBusiness;
    setContactBusiness(parsedContactBusiness ?? "");
    setContactPerson(parsed.contactPerson ?? "");
    setNumber(parsedToNumber ?? "+61 ");
    if (parsed.vendorName) setUserName(parsed.vendorName);
    setInvoiceNumber(nextInvoiceNumber);
    setInvoiceDate(parsed.invoiceDate ?? "");
    setDueDate(parsed.dueDate ?? "");
    setAmountDue(parsed.amountDue == null ? "" : String(parsed.amountDue));
    setCurrency(parsed.currency ?? "");
    setLineItems(parsed.lineItems ?? "");
    setInvoiceNotes(parsed.invoiceNotes ?? "");
    setBankName(parsed.bankName ?? "");
    setBsb(parsed.bsb ?? "");
    setAccountNumber(parsed.accountNumber ?? "");
    setSwiftCode(parsed.swiftCode ?? "");
    setAbn(parsed.abn ?? "");
    setRemittanceName(parsed.remittanceName ?? "");
    setRemittanceContact(parsed.remittanceContact ?? "");
    const objParts: string[] = ["Follow up on payment for invoice"];
    if (nextInvoiceNumber) objParts.push(nextInvoiceNumber);
    if (parsed.amountDue != null) {
      objParts.push(`(${fmtAmount(parsed.currency, parsed.amountDue)} outstanding)`);
    }
    if (parsed.dueDate) objParts.push(`— due ${fmtDate(parsed.dueDate)}`);
    objParts.push(". Confirm whether payment has been made or is scheduled. If overdue, politely arrange a settlement date or payment plan.");
    setObjective(objParts.join(" "));
    setStage("review");

    if (!parsedToNumber && parsedContactBusiness) {
      try {
        const params = new URLSearchParams();
        params.set("contactBusiness", parsedContactBusiness);
        if (parsed.invoiceNumber) params.set("invoiceNumber", parsed.invoiceNumber);
        const r = await fetch(`/api/contacts/lookup?${params}`);
        if (r.ok) {
          const data = (await r.json()) as { phone: string | null };
          if (data.phone) {
            setNumber(data.phone);
            setPhoneSource("contacts");
          }
        }
      } catch {
        // non-blocking — leave field empty for manual entry
      }
    } else if (parsedToNumber) {
      setPhoneSource("parsed");
    }
  };

  const parseInvoice = async () => {
    if (!documentFile || parsing) return;
    setParsing(true);
    setParseError(null);

    try {
      const formData = new FormData();
      formData.append("document", documentFile);

      const response = await fetch("/api/calls/parse-document", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as InvoiceParseResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      handleParseSuccess(payload);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Failed to parse invoice");
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onPlace({
        contactBusiness: contactBusiness || "Accounts Payable",
        contactPerson: contactPerson || undefined,
        toNumber: number,
        objective,
        voice,
        manner,
        userName: userName || "the caller",
        invoiceNumber: invoiceNumber || undefined,
        invoiceDate: invoiceDate || undefined,
        dueDate: dueDate || undefined,
        amountDue: amountDue.trim() ? Number(amountDue) : undefined,
        currency: currency || undefined,
        lineItems: lineItems || undefined,
        invoiceNotes: invoiceNotes || undefined,
        bankName: bankName || undefined,
        bsb: bsb || undefined,
        accountNumber: accountNumber || undefined,
        swiftCode: swiftCode || undefined,
        abn: abn || undefined,
        remittanceName: remittanceName || undefined,
        remittanceContact: remittanceContact || undefined,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to dispatch");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pb-40 fade-in">
      <header className="px-6 pt-12 pb-6 flex items-center justify-between">
        <button
          onClick={() => {
            if (onBackWithState) {
              onBackWithState({ toNumber: number, contactBusiness, contactPerson, vendorName: userName, invoiceNumber, invoiceDate, dueDate, amountDue, currency, lineItems, invoiceNotes, bankName, bsb, accountNumber, swiftCode, abn, remittanceName, remittanceContact });
            } else {
              onCancel();
            }
          }}
          className="-ml-2 px-2 py-1.5 flex items-center gap-1 text-[0.92rem]"
          style={{ color: "var(--muted)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </header>

      {stage === "upload" ? (
        <>
          <div className="px-6 mb-8">
            <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>Invoice upload</p>
            <h1 className="font-display text-[2.2rem] leading-[1.05] font-light tracking-tight">
              Upload the invoice,<br/>
              <span className="italic" style={{ color: "var(--burgundy)" }}>then review the brief.</span>
            </h1>
          </div>

          <div className="px-6">
            <div
              className="rounded-md border p-5"
              style={{ background: "var(--cream-light)", borderColor: "var(--hairline)" }}
            >
              <label className="smallcaps mb-1 block" style={{ color: "var(--muted)" }}>
                PDF document
              </label>
              <p className="text-[0.78rem] mb-3" style={{ color: "var(--muted-light)" }}>
                Select one file to parse, or multiple for bulk upload.
              </p>
              <input
                type="file"
                accept="application/pdf"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 1 && onBulkFiles) {
                    onBulkFiles(files);
                  } else {
                    setDocumentFile(files[0] ?? null);
                    setParseError(null);
                  }
                }}
                className="block w-full text-[0.95rem]"
                style={{ color: "var(--ink)" }}
              />
              {documentFile && (
                <p className="mt-3 text-[0.9rem] leading-snug" style={{ color: "var(--muted)" }}>
                  {documentFile.name}
                </p>
              )}
            </div>

            {parseError && (
              <div className="mt-5 p-4 rounded-md text-[0.9rem] leading-snug" style={{ background: "var(--burgundy-tint)", color: "var(--burgundy)" }}>
                <strong className="block mb-1">Reading failed</strong>
                {parseError}
                <button
                  onClick={parseInvoice}
                  className="mt-3 text-[0.82rem] underline underline-offset-2"
                  style={{ color: "inherit" }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          <div
            className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-5 pb-7 pt-14"
            style={{ background: "linear-gradient(to top, var(--cream) 65%, transparent)" }}
          >
            <button
              disabled={!documentFile || parsing}
              onClick={parseInvoice}
              className="w-full py-4 rounded-full flex items-center justify-center gap-2.5 font-medium text-[1rem] transition active:scale-[0.98]"
              style={{
                background: documentFile && !parsing ? "var(--burgundy)" : "var(--hairline-strong)",
                color: "var(--cream)",
                letterSpacing: "-0.01em",
                opacity: documentFile && !parsing ? 1 : 0.7,
              }}
            >
              {parsing ? "Reading invoice..." : "Upload and read invoice"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="px-6 mb-8">
            <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>New brief</p>
            <h1 className="font-display text-[2.2rem] leading-[1.05] font-light tracking-tight">
              Review the details,<br/>
              <span className="italic" style={{ color: "var(--burgundy)" }}>then dispatch Envoy.</span>
            </h1>
          </div>

          <div className="px-6 space-y-8">
            <div>
              <p className="smallcaps mb-4" style={{ color: "var(--muted)" }}>Call brief</p>

              <div className="space-y-7">
                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Number to call</label>
                  <input
                    type="tel"
                    value={number}
                    onChange={(e) => { setNumber(e.target.value); setPhoneSource("manual"); }}
                    placeholder="+61 4..."
                    className="w-full pb-3 font-mono text-[1.2rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                  {phoneSource === "contacts" && (
                    <p className="text-[0.72rem] mt-1.5" style={{ color: "var(--muted)" }}>Found in contacts</p>
                  )}
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Business</label>
                  <input
                    type="text"
                    value={contactBusiness}
                    onChange={(e) => setContactBusiness(e.target.value)}
                    placeholder="e.g. Acme"
                    className="w-full pb-3 text-[1.05rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>
                    Contact person <span style={{ color: "var(--muted-light)" }}>· optional, used only when asked</span>
                  </label>
                  <input
                    type="text"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    placeholder="e.g. Ameet"
                    className="w-full pb-3 text-[1.05rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>
                    Your name / business <span style={{ color: "var(--muted-light)" }}>· how Envoy refers to you</span>
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="e.g. Suresh"
                    className="w-full pb-3 text-[1.05rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Objective</label>
                  <textarea
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="What do you want Envoy to achieve? Be specific — dates, names, prices, alternatives."
                    rows={4}
                    className="w-full pb-3 text-[1.05rem] bg-transparent leading-relaxed resize-none"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-3 block" style={{ color: "var(--muted)" }}>Voice</label>
                  <div className="grid grid-cols-3 gap-2">
                    {voices.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setVoice(v.id)}
                        className="text-left p-3 rounded-md border transition"
                        style={{
                          borderColor: voice === v.id ? "var(--ink)" : "var(--hairline)",
                          background: voice === v.id ? "var(--ink)" : "var(--cream-light)",
                          color: voice === v.id ? "var(--cream)" : "var(--ink)",
                        }}
                      >
                        <div className="font-display text-[0.95rem] font-medium leading-none mb-1">{v.name}</div>
                        <div className="text-[0.7rem] leading-tight" style={{ opacity: voice === v.id ? 0.7 : 0.55 }}>{v.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="smallcaps mb-3 block" style={{ color: "var(--muted)" }}>Manner</label>
                  <div className="grid grid-cols-3 gap-2">
                    {manners.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setManner(p.id)}
                        className="text-left p-3 rounded-md border transition"
                        style={{
                          borderColor: manner === p.id ? "var(--ink)" : "var(--hairline)",
                          background: manner === p.id ? "var(--ink)" : "var(--cream-light)",
                          color: manner === p.id ? "var(--cream)" : "var(--ink)",
                        }}
                      >
                        <div className="font-display text-[0.95rem] font-medium leading-none mb-1">{p.name}</div>
                        <div className="text-[0.7rem] leading-tight" style={{ opacity: manner === p.id ? 0.7 : 0.55 }}>{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="smallcaps mb-4" style={{ color: "var(--muted)" }}>Invoice details</p>

              <div className="space-y-7">
                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Invoice number</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="w-full pb-3 text-[1.05rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Invoice date</label>
                  <input
                    type="text"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    placeholder="YYYY-MM-DD"
                    className="w-full pb-3 text-[1.05rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Due date</label>
                  <input
                    type="text"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    placeholder="YYYY-MM-DD"
                    className="w-full pb-3 text-[1.05rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Amount due</label>
                  <input
                    type="text"
                    value={amountDue}
                    onChange={(e) => setAmountDue(e.target.value)}
                    className="w-full pb-3 text-[1.05rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Currency</label>
                  <input
                    type="text"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    placeholder="e.g. AUD"
                    className="w-full pb-3 text-[1.05rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                {lineItems && (() => {
                  let items: { description: string | null; quantity: number | null; unitPrice: number | null; amount: number | null }[] | null = null;
                  try { items = JSON.parse(lineItems); } catch { /* not valid JSON, skip */ }
                  if (!Array.isArray(items) || items.length === 0) return null;
                  return (
                    <div>
                      <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Line items</label>
                      <div className="w-full overflow-x-auto" style={{ borderBottom: "1px solid var(--hairline-strong)" }}>
                        <table className="w-full text-[0.88rem] pb-3" style={{ borderCollapse: "collapse", color: "var(--ink)" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
                              <th className="text-left py-1.5 pr-4 font-medium" style={{ color: "var(--muted)" }}>Description</th>
                              <th className="text-right py-1.5 pr-4 font-medium" style={{ color: "var(--muted)" }}>Qty</th>
                              <th className="text-right py-1.5 pr-4 font-medium" style={{ color: "var(--muted)" }}>Unit price</th>
                              <th className="text-right py-1.5 font-medium" style={{ color: "var(--muted)" }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, i) => (
                              <tr key={i} style={{ borderBottom: i < items!.length - 1 ? "1px solid var(--hairline)" : "none" }}>
                                <td className="py-1.5 pr-4">{item.description ?? "—"}</td>
                                <td className="py-1.5 pr-4 text-right">{item.quantity ?? "—"}</td>
                                <td className="py-1.5 pr-4 text-right">{item.unitPrice != null ? item.unitPrice.toLocaleString() : "—"}</td>
                                <td className="py-1.5 text-right">{item.amount != null ? item.amount.toLocaleString() : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <p className="smallcaps mb-4" style={{ color: "var(--muted)" }}>Payment details</p>

                  <div className="space-y-7">
                    <div>
                      <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Bank name</label>
                      <input
                        type="text"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        placeholder="e.g. Deutsche Bank AG"
                        className="w-full pb-3 text-[1.05rem] bg-transparent"
                        style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                      />
                    </div>

                    <div>
                      <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>BSB</label>
                      <input
                        type="text"
                        value={bsb}
                        onChange={(e) => setBsb(e.target.value)}
                        placeholder="e.g. 414111"
                        className="w-full pb-3 text-[1.05rem] bg-transparent"
                        style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                      />
                    </div>

                    <div>
                      <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Account number</label>
                      <input
                        type="text"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        placeholder="e.g. 180010301"
                        className="w-full pb-3 text-[1.05rem] bg-transparent"
                        style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                      />
                    </div>

                    <div>
                      <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>SWIFT / BIC</label>
                      <input
                        type="text"
                        value={swiftCode}
                        onChange={(e) => setSwiftCode(e.target.value)}
                        placeholder="e.g. DEUTAU2SGTB"
                        className="w-full pb-3 text-[1.05rem] bg-transparent"
                        style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                      />
                    </div>

                    <div>
                      <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>ABN</label>
                      <input
                        type="text"
                        value={abn}
                        onChange={(e) => setAbn(e.target.value)}
                        placeholder="e.g. 59 863 426 362"
                        className="w-full pb-3 text-[1.05rem] bg-transparent"
                        style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                      />
                    </div>

                    <div>
                      <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Remit to (name)</label>
                      <input
                        type="text"
                        value={remittanceName}
                        onChange={(e) => setRemittanceName(e.target.value)}
                        placeholder="e.g. Quest Software International Limited"
                        className="w-full pb-3 text-[1.05rem] bg-transparent"
                        style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                      />
                    </div>

                    <div>
                      <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Remit to (contact)</label>
                      <input
                        type="text"
                        value={remittanceContact}
                        onChange={(e) => setRemittanceContact(e.target.value)}
                        placeholder="Address or email for remittance advice"
                        className="w-full pb-3 text-[1.05rem] bg-transparent"
                        style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Invoice notes</label>
                  <textarea
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    rows={invoiceNotes ? 4 : 2}
                    className="w-full pb-3 text-[1.05rem] bg-transparent leading-relaxed resize-none"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>
              </div>
            </div>

            {submitError && (
              <div className="p-4 rounded-md text-[0.9rem] leading-snug" style={{ background: "var(--burgundy-tint)", color: "var(--burgundy)" }}>
                <strong className="block mb-1">Dispatch failed</strong>
                {submitError}
              </div>
            )}
          </div>

          <div
            className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-5 pb-7 pt-14"
            style={{ background: "linear-gradient(to top, var(--cream) 65%, transparent)" }}
          >
            <button
              disabled={!isValid}
              onClick={submit}
              className="w-full py-4 rounded-full flex items-center justify-center gap-2.5 font-medium text-[1rem] transition active:scale-[0.98]"
              style={{
                background: isValid ? "var(--burgundy)" : "var(--hairline-strong)",
                color: "var(--cream)",
                letterSpacing: "-0.01em",
                opacity: isValid ? 1 : 0.7,
              }}
            >
              {submitting ? "Dispatching…" : isValid ? "Dispatch Envoy" : "Fill the brief first"}
            </button>
            <p className="text-center mt-3 text-[0.72rem]" style={{ color: "var(--muted-light)" }}>
              The call is recorded. Envoy identifies itself as an AI agent.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Live ───────────────────────────────────────────────────────────────

function Live({
  callId,
  onDone,
  onViewDetail,
}: {
  callId: string;
  onDone: () => void;
  onViewDetail: () => void;
}) {
  const [call, setCall] = useState<Call | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const startedAt = useRef(Date.now());
  const transcriptRef = useRef<HTMLDivElement>(null);
  const POLL_TIMEOUT_MS = 5 * 60 * 1000;

  // Timer
  useEffect(() => {
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, []);

  // Poll backend
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive || Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
        if (alive) setPollTimedOut(true);
        return;
      }
      try {
        const r = await fetch(`/api/calls/${callId}`, { cache: "no-store" });
        if (!alive) return;
        if (r.ok) {
          const c = (await r.json()) as Call;
          setCall(c);
          if (c.status === "completed" || c.status === "failed") return; // stop polling
        }
      } catch {}
      if (alive) setTimeout(tick, 2000);
    };
    tick();
    return () => { alive = false; };
  }, [callId, pollTimedOut]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [call?.transcript]);

  const status: Status = call?.status ?? "dispatching";
  const finished = status === "completed" || status === "failed" || pollTimedOut;
  // Stay on "Ringing" until actual speech is present, even if backend advanced to "in-progress".
  // Vapi fires in-progress when its audio stream connects (voicemail detection), not when a human answers.
  const displayStatus: Status =
    status === "in-progress" && (!call?.transcript || call.transcript.length === 0)
      ? "ringing"
      : status;

  return (
    <div
      className="min-h-screen flex flex-col fade-in"
      style={{
        background: finished ? "var(--cream)" : "var(--ink)",
        color: finished ? "var(--ink)" : "var(--cream)",
      }}
    >
      <header className="px-6 pt-12 pb-6">
        <div className="flex items-center justify-between mb-8">
          <p className="smallcaps" style={{ color: finished ? "var(--muted)" : "var(--muted-light)", opacity: 0.8 }}>
            Live · Envoy
          </p>
          <div className="flex items-center gap-2">
            <div
              className={!finished ? "dot-pulse" : ""}
              style={{
                width: 8, height: 8, borderRadius: 999,
                background: finished ? "var(--success)" : "var(--burgundy-light)",
              }}
            />
            <span className="smallcaps" style={{ opacity: 0.8 }}>{statusLabel(displayStatus)}</span>
          </div>
        </div>

        <h2 className="font-display text-[1.85rem] leading-tight font-light tracking-tight mb-1">
          {call?.contactBusiness ?? "…"}
        </h2>
        <p className="font-mono text-[0.85rem]" style={{ opacity: 0.6 }}>{call?.toNumber ?? ""}</p>

        {call?.objective && (
          <div
            className="mt-5 p-4 rounded-md"
            style={{
              background: finished ? "var(--cream-light)" : "rgba(244,239,230,0.06)",
              border: `1px solid ${finished ? "var(--hairline)" : "rgba(244,239,230,0.12)"}`,
            }}
          >
            <p className="smallcaps mb-1.5" style={{ opacity: 0.6 }}>Brief</p>
            <p className="text-[0.95rem] leading-snug" style={{ opacity: 0.95 }}>{call.objective}</p>
          </div>
        )}
      </header>

      {!finished && (
        <div className="flex flex-col items-center justify-center py-6">
          <div className="relative mb-4">
            <div
              className={displayStatus === "dispatching" || displayStatus === "ringing" ? "pulse-ring" : ""}
              style={{
                width: 78, height: 78, borderRadius: 999,
                background: "var(--burgundy)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <WaveAnim active={displayStatus === "in-progress"} />
            </div>
          </div>
          <div className="font-mono text-[1.3rem] tracking-wider" style={{ opacity: 0.9 }}>
            {fmtDuration(elapsed)}
          </div>
        </div>
      )}

      <div
        ref={transcriptRef}
        className="flex-1 px-6 pb-4 overflow-y-auto scroll-hidden transcript-scroll"
        style={{ maxHeight: finished ? "none" : "38vh" }}
      >
        {call?.transcript?.map((line, i) => (
          <div key={i} className="mb-4 fade-up">
            <p
              className="smallcaps mb-1"
              style={{ color: line.who === "envoy" ? "#D4A574" : "var(--muted-light)" }}
            >
              {line.who === "envoy" ? "Envoy" : call.contactBusiness.split(" ")[0]}
            </p>
            <p className="text-[0.96rem] leading-relaxed" style={{ opacity: 0.95 }}>{line.text}</p>
          </div>
        ))}
        {finished && call?.summary && (
          <div className="mt-6 fade-up">
            <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>Envoy's report</p>
            <p className="font-display text-[1rem] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              {call.summary}
            </p>
          </div>
        )}
        {pollTimedOut && status !== "completed" && status !== "failed" && (
          <div className="mt-6 fade-up">
            <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>Report pending</p>
            <p className="text-[0.95rem] leading-relaxed" style={{ color: "var(--ink-soft)" }}>
              The call ended but the report hasn't arrived. Check that your ngrok tunnel is running and PUBLIC_URL in .env matches the current tunnel URL, then restart the dev server. The transcript will appear in History once it processes.
            </p>
          </div>
        )}
      </div>

      <div className="px-5 pb-7 pt-3">
        <button
          onClick={finished ? onViewDetail : onDone}
          className="w-full py-4 rounded-full text-[1rem] font-medium transition active:scale-[0.98]"
          style={{
            background: finished ? "var(--ink)" : "rgba(244,239,230,0.08)",
            border: finished ? "none" : "1px solid rgba(244,239,230,0.2)",
            color: "var(--cream)",
          }}
        >
          {finished ? "View transcript" : "Back to history"}
        </button>
      </div>
    </div>
  );
}

// ─── Detail ─────────────────────────────────────────────────────────────

function Detail({ call, onBack }: { call: Call; onBack: () => void }) {
  const oc = outcomeStyle(call.outcome);
  const VOICEMAIL_PHRASES = /audio message|leave a message|leave your message|not available|unavailable|voicemail|answering machine|at the tone|after the beep|record your message|send a message/i;
  const isVoicemail = !!(
    (call.endedReason && /voicemail|machine/i.test(call.endedReason)) ||
    (call.transcript ?? []).some((l) => l.who === "them" && VOICEMAIL_PHRASES.test(l.text))
  );
  const isInvoice = !!call.invoiceNumber;

  // For voicemail calls, show the actual message left. The AI often appends a short
  // trailing farewell ("Goodbye.") after the voicemail script, so the LAST Envoy line is
  // usually that farewell — not the message. The voicemail script is a full sentence
  // (greeting + call-back request), so pick the LONGEST Envoy line instead.
  const voicemailLines = isVoicemail
    ? (() => {
        const envoyLines = (call.transcript ?? []).filter((l) => l.who === "envoy");
        if (envoyLines.length === 0) return [];
        const longest = envoyLines.reduce((a, b) => (b.text.length > a.text.length ? b : a));
        return [longest];
      })()
    : [];

  return (
    <div className="min-h-screen pb-16 fade-in">
      <header className="px-6 pt-12 pb-6">
        <button onClick={onBack} className="-ml-2 px-2 py-1.5 flex items-center gap-1 text-[0.92rem] mb-6" style={{ color: "var(--muted)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="flex items-center gap-2 mb-3">
          <span className="smallcaps px-2 py-1 rounded-sm" style={{ background: oc.bg, color: oc.fg }}>{oc.label}</span>
          <span className="font-mono text-[0.72rem]" style={{ color: "var(--muted)" }}>
            {fmtWhen(call.createdAt)} · {fmtDuration(call.durationSec)}
          </span>
        </div>

        <h1 className="font-display text-[2rem] leading-tight font-light tracking-tight mb-1">{call.contactBusiness}</h1>
        <p className="font-mono text-[0.85rem]" style={{ color: "var(--muted)" }}>{call.toNumber}</p>
      </header>

      <Hairline />

      {/* Outcome — for invoice calls show the full AI summary; for others show the brief result line */}
      {isInvoice ? (
        call.summary && (
          <>
            <section className="px-6 py-7">
              <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>Outcome</p>
              <p className="text-[1rem] leading-relaxed" style={{ color: "var(--ink)" }}>
                {call.summary}
              </p>
            </section>
            <Hairline />
          </>
        )
      ) : (
        call.result && (
          <>
            <section className="px-6 py-7">
              <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>Outcome</p>
              <p className="font-display text-[1.4rem] leading-snug font-medium tracking-tight" style={{ color: "var(--burgundy)" }}>
                {call.result}
              </p>
            </section>
            <Hairline />
          </>
        )
      )}

      <section className="px-6 py-6">
        <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>The brief</p>
        <p className="text-[1rem] leading-relaxed">{call.objective}</p>
      </section>

      {/* Envoy's report — for voicemail calls this carries the "went to voicemail" note;
          for invoice calls the summary is already shown above so skip it here */}
      {call.summary && !isInvoice && (
        <>
          <Hairline />
          <section className="px-6 py-6">
            <p className="smallcaps mb-3" style={{ color: "var(--muted)" }}>Envoy's report</p>
            <p className="text-[1rem] leading-relaxed font-display font-light" style={{ color: "var(--ink-soft)" }}>
              {call.summary}
            </p>
          </section>
        </>
      )}

      {isVoicemail ? (
        voicemailLines.length > 0 && (
          <>
            <Hairline />
            <section className="px-6 py-6">
              <p className="smallcaps mb-4" style={{ color: "var(--muted)" }}>Voicemail message</p>
              <div className="space-y-4">
                {voicemailLines.map((line, i) => (
                  <div key={i}>
                    <p className="smallcaps mb-1" style={{ color: "var(--burgundy)" }}>Envoy</p>
                    <p className="text-[0.95rem] leading-relaxed">{line.text}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )
      ) : (
        call.transcript && call.transcript.length > 0 && (
          <>
            <Hairline />
            <section className="px-6 py-6">
              <p className="smallcaps mb-4" style={{ color: "var(--muted)" }}>Transcript</p>
              <div className="space-y-4">
                {call.transcript.map((line, i) => (
                  <div key={i}>
                    <p className="smallcaps mb-1" style={{ color: line.who === "envoy" ? "var(--burgundy)" : "var(--muted)" }}>
                      {line.who === "envoy" ? "Envoy" : call.contactBusiness.split(" ")[0]}
                    </p>
                    <p className="text-[0.95rem] leading-relaxed">{line.text}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )
      )}

      {call.recordingUrl && (
        <>
          <Hairline />
          <section className="px-6 py-7">
            <a
              href={`/api/calls/${call.id}/recording`}
              target="_blank"
              rel="noreferrer"
              className="w-full py-3.5 rounded-full border text-[0.95rem] font-medium block text-center"
              style={{ background: "var(--cream-light)", borderColor: "var(--hairline)" }}
            >
              Play recording
            </a>
          </section>
        </>
      )}
    </div>
  );
}

// ─── Bulk Invoice ────────────────────────────────────────────────────────

function BulkItemRow({
  item,
  onDetails,
  onDispatch,
  onRetry,
  onRemove,
  onViewDetail,
}: {
  item: BulkItem;
  onDetails: () => void;
  onDispatch: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onViewDetail?: () => void;
}) {
  const { status, fileName, parsed, error, callStatus, callOutcome, callPollError } = item;
  const canDispatch = (status === "parsed" || status === "dispatch-error") &&
    hasCallableNumber(parsed?.toNumber);
  const isSettled = status === "dispatched" && (callStatus === "completed" || callStatus === "failed");
  const outcomeInfo = isSettled ? outcomeStyle(callOutcome ?? null) : null;

  return (
    <div
      className="rounded-md border p-4 relative"
      style={{
        background: "var(--cream-light)",
        borderColor: "var(--hairline)",
        cursor: isSettled && onViewDetail ? "pointer" : undefined,
      }}
      onClick={isSettled ? onViewDetail : undefined}
    >
      {/* Remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute w-5 h-5 flex items-center justify-center rounded-full border text-[0.65rem] leading-none transition hover:opacity-60"
        style={{ top: "-10px", right: "-10px", zIndex: 10, color: "var(--muted)", borderColor: "var(--hairline-strong)", background: "var(--cream)" }}
        title="Remove"
      >
        ×
      </button>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[0.92rem] font-medium truncate" style={{ color: "var(--ink)" }}>
            {fileName}
          </p>
          {(status === "parsed" || status === "dispatching" || status === "dispatched" || status === "dispatch-error") && parsed && (
            <p className="text-[0.78rem] mt-0.5 truncate" style={{ color: "var(--muted)" }}>
              {[parsed.vendorName, fmtAmount(parsed.currency, parsed.amountDue) || null, parsed.dueDate ? `due ${fmtDate(parsed.dueDate)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {status === "parse-error" && (
            <p className="text-[0.78rem] mt-0.5" style={{ color: "var(--burgundy)" }}>{error}</p>
          )}
          {status === "dispatch-error" && (
            <p className="text-[0.78rem] mt-0.5" style={{ color: "var(--burgundy)" }}>{error}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {status === "parsing" && (
            <span className="text-[0.78rem]" style={{ color: "var(--muted)" }}>Reading…</span>
          )}
          {status === "dispatching" && (
            <span className="text-[0.78rem]" style={{ color: "var(--muted)" }}>Dispatching…</span>
          )}
          {status === "dispatched" && !callStatus && (
            <span className="text-[0.78rem]" style={{ color: "var(--muted)" }}>Dispatched…</span>
          )}
          {status === "dispatched" && callStatus && !isSettled && callPollError && (
            <span className="text-[0.78rem] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--warning-tint)", color: "var(--warning)" }}>
              Vapi unreachable
            </span>
          )}
          {status === "dispatched" && callStatus && !isSettled && !callPollError && (
            <span className="text-[0.78rem]" style={{ color: "var(--muted)" }}>
              {callStatus === "queued" ? "Connecting…" : callStatus === "ringing" ? "Ringing…" : "In conversation"}
            </span>
          )}
          {isSettled && outcomeInfo && (
            <span
              className="text-[0.78rem] font-medium px-2 py-0.5 rounded-full"
              style={{ background: outcomeInfo.bg, color: outcomeInfo.fg }}
            >
              {outcomeInfo.label}
            </span>
          )}
          {status === "parse-error" && (
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              className="text-[0.78rem] underline underline-offset-2"
              style={{ color: "var(--burgundy)" }}
            >
              Retry
            </button>
          )}
          {(status === "parsed" || status === "dispatch-error") && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onDetails(); }}
                className="px-3 py-1.5 rounded-full text-[0.78rem] font-medium border"
                style={{ borderColor: "var(--hairline-strong)", color: "var(--ink)", background: "var(--cream)" }}
              >
                Details
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDispatch(); }}
                disabled={!canDispatch}
                className="px-3 py-1.5 rounded-full text-[0.78rem] font-medium transition"
                style={{
                  background: canDispatch ? "var(--burgundy)" : "var(--hairline-strong)",
                  color: "var(--cream)",
                  opacity: canDispatch ? 1 : 0.6,
                  cursor: canDispatch ? "pointer" : "not-allowed",
                }}
                title={!canDispatch ? "No phone number found — use Details to add one" : undefined}
              >
                Dispatch
              </button>
            </>
          )}
        </div>
      </div>

      {isSettled && onViewDetail && (
        <p className="text-[0.72rem] mt-2" style={{ color: "var(--muted-light)" }}>
          Tap to view transcript →
        </p>
      )}
    </div>
  );
}

function BulkInvoiceScreen({
  items,
  onAddFiles,
  onDetails,
  onDispatch,
  onRetry,
  onRemove,
  onViewDetail,
  onBack,
  onDispatchAll,
  isDispatching,
}: {
  items: BulkItem[];
  onAddFiles: (files: File[]) => void;
  onDetails: (uid: string) => void;
  onDispatch: (uid: string) => void;
  onRetry: (uid: string) => void;
  onRemove: (uid: string) => void;
  onViewDetail: (callId: string) => void;
  onBack: () => void;
  onDispatchAll: () => void;
  isDispatching: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsing = items.filter((i) => i.status === "parsing").length;
  const dispatched = items.filter((i) => i.status === "dispatched").length;
  const dispatchReady = items.filter((i) => i.status === "parsed" && hasCallableNumber(i.parsed?.toNumber)).length;

  return (
    <div className="min-h-screen pb-32 fade-in">
      <header className="px-6 pt-12 pb-6 flex items-center justify-between">
        <button onClick={onBack} className="-ml-2 px-2 py-1.5 flex items-center gap-1 text-[0.92rem]" style={{ color: "var(--muted)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <Brand />
      </header>

      <div className="px-6 mb-6">
        <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>Bulk upload</p>
        <h1 className="font-display text-[2.2rem] leading-[1.05] font-light tracking-tight">
          Upload invoices,<br />
          <span className="italic" style={{ color: "var(--burgundy)" }}>dispatch in bulk.</span>
        </h1>
        {items.length > 0 && (
          <p className="text-[0.82rem] mt-3" style={{ color: "var(--muted)" }}>
            {parsing > 0 ? `${parsing} reading…` : null}
            {parsing > 0 && dispatched > 0 ? " · " : null}
            {dispatched > 0 ? `${dispatched} dispatched` : null}
            {parsing === 0 && dispatched === 0 ? `${items.length} invoice${items.length !== 1 ? "s" : ""}` : null}
          </p>
        )}
      </div>

      <div className="px-6 mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onAddFiles(files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-3 rounded-full border text-[0.95rem] font-medium flex items-center justify-center gap-2"
          style={{ borderColor: "var(--hairline-strong)", color: "var(--ink)", background: "var(--cream-light)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 5v14M5 12l7-7 7 7" />
          </svg>
          Add PDFs
        </button>
      </div>

      {items.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-[0.95rem]" style={{ color: "var(--muted)" }}>No invoices yet.</p>
          <p className="text-[0.82rem] mt-1" style={{ color: "var(--muted-light)" }}>Click "Add PDFs" to get started.</p>
        </div>
      ) : (
        <div className="px-6 space-y-3 pb-40">
          {items.map((item) => (
            <BulkItemRow
              key={item.uid}
              item={item}
              onDetails={() => onDetails(item.uid)}
              onDispatch={() => onDispatch(item.uid)}
              onRetry={() => onRetry(item.uid)}
              onRemove={() => onRemove(item.uid)}
              onViewDetail={item.callId ? () => onViewDetail(item.callId!) : undefined}
            />
          ))}
        </div>
      )}

      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-5 pb-7 pt-14"
        style={{ background: "linear-gradient(to top, var(--cream) 65%, transparent)" }}
      >
        <button
          disabled={dispatchReady === 0 || isDispatching}
          onClick={onDispatchAll}
          className="w-full py-4 rounded-full font-medium text-[1rem] transition active:scale-[0.98]"
          style={{
            background: dispatchReady > 0 && !isDispatching ? "var(--burgundy)" : "var(--hairline-strong)",
            color: "var(--cream)",
            opacity: dispatchReady > 0 && !isDispatching ? 1 : 0.6,
            cursor: dispatchReady > 0 && !isDispatching ? "pointer" : "not-allowed",
            letterSpacing: "-0.01em",
          }}
        >
          {isDispatching
            ? "Dispatching…"
            : dispatchReady > 0 ? `Dispatch All (${dispatchReady})` : "Dispatch All"}
        </button>
      </div>
    </div>
  );
}

// ─── Select Invoice ──────────────────────────────────────────────────────

function SelectInvoiceScreen({
  driveFiles,
  driveLoading,
  driveError,
  queue,
  dispatching,
  onToggleDrive,
  onSelectAllDrive,
  onDeselectAllDrive,
  onDispatch,
  onBack,
}: {
  driveFiles: DriveInvoiceFile[];
  driveLoading: boolean;
  driveError: string | null;
  queue: BulkItem[];
  dispatching: boolean;
  onToggleDrive: (f: DriveInvoiceFile) => void;
  onSelectAllDrive: () => void;
  onDeselectAllDrive: () => void;
  onDispatch: (selectedUploadFiles: File[]) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"drive" | "upload">("drive");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{ uid: string; file: File; selected: boolean }[]>([]);

  const selectedDriveIds = new Set(queue.filter((i) => i.driveFileId).map((i) => i.driveFileId!));
  const selectedUploadCount = uploadedFiles.filter((f) => f.selected).length;
  const totalDispatchCount = queue.length + selectedUploadCount;
  const hasDispatchable = totalDispatchCount > 0;

  return (
    <div className="min-h-screen pb-36 fade-in">
      <header className="px-6 pt-12 pb-6 flex items-center justify-between">
        <button onClick={onBack} className="-ml-2 px-2 py-1.5 flex items-center gap-1 text-[0.92rem]" style={{ color: "var(--muted)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <Brand />
      </header>

      <div className="px-6 mb-6">
        <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>Invoice dispatch</p>
        <h1 className="font-display text-[2.2rem] leading-[1.05] font-light tracking-tight">
          Select invoices,<br />
          <span className="italic" style={{ color: "var(--burgundy)" }}>dispatch Envoy.</span>
        </h1>
      </div>

      {/* Tab toggle */}
      <div className="px-6 mb-4">
        <div className="flex rounded-full border overflow-hidden" style={{ borderColor: "var(--hairline-strong)", background: "var(--cream-light)" }}>
          {(["drive", "upload"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2.5 text-[0.85rem] font-medium transition"
              style={{
                background: tab === t ? "var(--ink)" : "transparent",
                color: tab === t ? "var(--cream)" : "var(--muted)",
                borderRadius: "inherit",
              }}
            >
              {t === "drive" ? "Google Drive" : "Upload files"}
            </button>
          ))}
        </div>
      </div>

      {/* Drive tab */}
      {tab === "drive" && (
        <div className="px-6">
          {driveLoading && (
            <p className="text-[0.88rem] py-6 text-center" style={{ color: "var(--muted)" }}>Loading Drive…</p>
          )}
          {driveError && !driveLoading && (
            <p className="text-[0.82rem] py-4" style={{ color: "var(--burgundy)" }}>{driveError}</p>
          )}
          {!driveLoading && !driveError && driveFiles.length === 0 && (
            <p className="text-[0.88rem] py-6 text-center" style={{ color: "var(--muted)" }}>No PDF invoices found in Drive.</p>
          )}
          {!driveLoading && !driveError && driveFiles.length > 0 && (
            <div className="flex justify-end mb-2">
              <button
                onClick={selectedDriveIds.size > 0 ? onDeselectAllDrive : onSelectAllDrive}
                className="text-[0.8rem] font-medium"
                style={{ color: "var(--burgundy)" }}
              >
                {selectedDriveIds.size > 0 ? "Deselect all" : "Select all"}
              </button>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {driveFiles.map((f) => {
              const selected = selectedDriveIds.has(f.fileId);
              return (
                <button
                  key={f.fileId}
                  onClick={() => onToggleDrive(f)}
                  className="w-full text-left px-4 py-3.5 rounded-md border flex items-center gap-3 transition"
                  style={{
                    background: selected ? "var(--burgundy-tint)" : "var(--cream-light)",
                    borderColor: selected ? "var(--burgundy)" : "var(--hairline)",
                  }}
                >
                  <div
                    className="w-5 h-5 rounded border flex items-center justify-center shrink-0"
                    style={{ borderColor: selected ? "var(--burgundy)" : "var(--hairline-strong)", background: selected ? "var(--burgundy)" : "transparent" }}
                  >
                    {selected && (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--cream)" strokeWidth="2">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9rem] font-medium truncate" style={{ color: "var(--ink)" }}>{f.name}</p>
                    <p className="text-[0.75rem] mt-0.5" style={{ color: "var(--muted)" }}>
                      {[fmtBytes(f.size), fmtWhen(f.modifiedTime)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Upload tab */}
      {tab === "upload" && (
        <div className="px-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (!e.target.files) return;
              const incoming = Array.from(e.target.files);
              setUploadedFiles((prev) => {
                const seen = new Set(prev.map((f) => `${f.file.name}::${f.file.size}`));
                const fresh = incoming
                  .filter((f) => !seen.has(`${f.name}::${f.size}`))
                  .map((f) => ({ uid: crypto.randomUUID(), file: f, selected: true }));
                return [...prev, ...fresh];
              });
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-10 rounded-md border-2 border-dashed flex flex-col items-center gap-2 transition"
            style={{ borderColor: "var(--hairline-strong)", color: "var(--muted)" }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 16V4" /><path d="M7 9l5-5 5 5" />
              <path d="M20 16.5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-2" />
            </svg>
            <span className="text-[0.88rem]">Choose PDF invoices</span>
          </button>

          {uploadedFiles.length > 0 && (
            <div className="mt-4">
              <div className="flex justify-end mb-2">
                <button
                  onClick={() => {
                    const anySelected = uploadedFiles.some((f) => f.selected);
                    setUploadedFiles((prev) => prev.map((f) => ({ ...f, selected: !anySelected })));
                  }}
                  className="text-[0.8rem] font-medium"
                  style={{ color: "var(--burgundy)" }}
                >
                  {uploadedFiles.some((f) => f.selected) ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {uploadedFiles.map((f) => (
                  <button
                    key={f.uid}
                    onClick={() => setUploadedFiles((prev) => prev.map((u) => u.uid === f.uid ? { ...u, selected: !u.selected } : u))}
                    className="w-full text-left px-4 py-3.5 rounded-md border flex items-center gap-3 transition"
                    style={{
                      background: f.selected ? "var(--burgundy-tint)" : "var(--cream-light)",
                      borderColor: f.selected ? "var(--burgundy)" : "var(--hairline)",
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded border flex items-center justify-center shrink-0"
                      style={{ borderColor: f.selected ? "var(--burgundy)" : "var(--hairline-strong)", background: f.selected ? "var(--burgundy)" : "transparent" }}
                    >
                      {f.selected && (
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--cream)" strokeWidth="2">
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.9rem] font-medium truncate" style={{ color: "var(--ink)" }}>{f.file.name}</p>
                      <p className="text-[0.75rem] mt-0.5" style={{ color: "var(--muted)" }}>{fmtBytes(f.file.size)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dispatch CTA */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-5 pb-7 pt-14"
        style={{ background: "linear-gradient(to top, var(--cream) 60%, transparent)" }}
      >
        <button
          onClick={() => onDispatch(uploadedFiles.filter((f) => f.selected).map((f) => f.file))}
          disabled={!hasDispatchable || dispatching}
          className="w-full py-4 rounded-full font-medium text-[1rem] transition active:scale-[0.98]"
          style={{
            background: hasDispatchable && !dispatching ? "var(--burgundy)" : "var(--hairline-strong)",
            color: "var(--cream)",
            opacity: hasDispatchable && !dispatching ? 1 : 0.6,
            cursor: hasDispatchable && !dispatching ? "pointer" : "not-allowed",
            letterSpacing: "-0.01em",
          }}
        >
          {dispatching ? "Dispatching…" : `Dispatch Envoy${totalDispatchCount > 0 ? ` (${totalDispatchCount})` : ""}`}
        </button>
      </div>
    </div>
  );
}

// ─── Bulk Summary ─────────────────────────────────────────────────────────

const isFailedItem = (i: BulkItem) =>
  i.status === "dispatch-error" || i.status === "parse-error" || i.callStatus === "failed";
const isInProgressItem = (i: BulkItem) =>
  i.status === "parsing" || i.status === "dispatching" ||
  i.callStatus === "queued" || i.callStatus === "ringing" || i.callStatus === "in-progress";

function BulkSummaryScreen({
  items,
  onViewDetail,
  onDetails,
  onBack,
  onRetryFailed,
}: {
  items: BulkItem[];
  onViewDetail: (callId: string) => void;
  onDetails: (uid: string) => void;
  onBack: () => void;
  onRetryFailed: () => void;
}) {
  const anyInProgress = items.some(isInProgressItem);
  const failedCount = items.filter(isFailedItem).length;
  const pausedCount = items.filter((i) => i.status === "paused").length;
  const retryCount = failedCount + pausedCount;
  const showRetry = !anyInProgress && retryCount > 0;

  const answeredCount = items.filter((i) => i.callOutcome === "success" || i.callOutcome === "partial").length;
  const noAnswerCount = items.filter((i) => i.callOutcome === "no-answer").length;
  const errorCount = items.filter((i) =>
    i.callOutcome === "failed" || i.status === "dispatch-error" || i.status === "parse-error"
  ).length;
  const inProgressCount = items.filter((i) => {
    if (i.callStatus === "completed" || i.callStatus === "failed") return false;
    if (i.status === "parse-error" || i.status === "dispatch-error") return false;
    return true;
  }).length;

  const getSummaryBadge = (item: BulkItem) => {
    // Terminal: show outcome
    if (item.callStatus === "completed" || item.callStatus === "failed") {
      const oc = outcomeStyle(item.callOutcome ?? null);
      return { label: oc.label, bg: oc.bg, fg: oc.fg, pulsing: false };
    }
    // Active call states
    if (item.callStatus === "in-progress") return { label: "In conversation", bg: "var(--burgundy-tint)", fg: "var(--burgundy)", pulsing: true };
    if (item.callStatus === "ringing") return { label: "Ringing", bg: "var(--burgundy-tint)", fg: "var(--burgundy)", pulsing: true };
    if (item.callStatus === "queued") return { label: "Connecting", bg: "var(--burgundy-tint)", fg: "var(--burgundy)", pulsing: true };
    // Dispatch states
    if (item.status === "dispatched") return { label: "Dispatched", bg: "var(--cream-dark)", fg: "var(--muted)", pulsing: false };
    if (item.status === "dispatching") return { label: "Dispatching…", bg: "var(--cream-dark)", fg: "var(--muted)", pulsing: true };
    if (item.status === "dispatch-error") return { label: "Failed", bg: "var(--burgundy-tint)", fg: "var(--burgundy)", pulsing: false };
    if (item.status === "parse-error") return { label: "Parse error", bg: "var(--warning-tint)", fg: "var(--warning)", pulsing: false };
    if (item.status === "paused") return { label: "Paused", bg: "var(--warning-tint)", fg: "var(--warning)", pulsing: false };
    if (item.status === "parsed") return { label: "Ready", bg: "var(--cream-dark)", fg: "var(--muted)", pulsing: false };
    // Default: parsing
    return { label: "Reading…", bg: "var(--cream-dark)", fg: "var(--muted)", pulsing: true };
  };

  return (
    <div className="min-h-screen pb-32 fade-in">
      <header className="px-6 pt-12 pb-6 flex items-center justify-between">
        <button onClick={onBack} className="-ml-2 px-2 py-1.5 flex items-center gap-1 text-[0.92rem]" style={{ color: "var(--muted)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <Brand />
      </header>

      <div className="px-6 mb-6">
        <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>Dispatch summary</p>
        <h1 className="font-display text-[2.2rem] leading-[1.05] font-light tracking-tight mb-4">
          {items.length} invoice{items.length !== 1 ? "s" : ""},<br />
          <span className="italic" style={{ color: "var(--burgundy)" }}>
            {anyInProgress ? "in progress." : "done."}
          </span>
        </h1>

        {/* Stats row */}
        <div className="flex gap-2 flex-wrap">
          {answeredCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "var(--success-tint, #e8f5e9)", color: "var(--success, #2e7d32)" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span className="text-[0.78rem] font-medium">{answeredCount} answered</span>
            </div>
          )}
          {noAnswerCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "var(--cream-dark)", color: "var(--muted)" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 3v3.5l2 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.4"/></svg>
              <span className="text-[0.78rem] font-medium">{noAnswerCount} no answer</span>
            </div>
          )}
          {errorCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: "var(--burgundy-tint)", color: "var(--burgundy)" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 4v3M6 8.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.4"/></svg>
              <span className="text-[0.78rem] font-medium">{errorCount} failed</span>
            </div>
          )}
          {inProgressCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full dot-pulse" style={{ background: "var(--cream-dark)", color: "var(--muted)" }}>
              <span className="text-[0.78rem] font-medium">{inProgressCount} in progress</span>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 flex flex-col gap-3">
        {items.map((item) => {
          const badge = getSummaryBadge(item);
          const isSettled = item.callStatus === "completed" || item.callStatus === "failed";
          const canEdit = item.status === "parsing" || item.status === "parsed" || item.status === "paused" || item.status === "dispatch-error";
          const title = item.parsed?.contactBusiness || item.fileName;
          const subtitle = [
            fmtAmount(item.parsed?.currency, item.parsed?.amountDue) || null,
            item.parsed?.dueDate ? `due ${fmtDate(item.parsed.dueDate)}` : null,
          ].filter(Boolean).join(" · ");

          return (
            <button
              key={item.uid}
              onClick={isSettled && item.callId ? () => onViewDetail(item.callId!) : undefined}
              className="w-full text-left px-4 py-4 rounded-md border flex items-center gap-3 transition"
              style={{
                background: "var(--cream-light)",
                borderColor: isSettled ? "var(--hairline-strong)" : "var(--hairline)",
                cursor: isSettled && item.callId ? "pointer" : "default",
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[0.92rem] font-medium truncate" style={{ color: "var(--ink)" }}>{title}</p>
                {subtitle && (
                  <p className="text-[0.77rem] mt-0.5 truncate" style={{ color: "var(--muted)" }}>{subtitle}</p>
                )}
                {item.error && (
                  <p className="text-[0.75rem] mt-0.5" style={{ color: "var(--burgundy)" }}>{item.error}</p>
                )}
                {isSettled && item.callId && (
                  <p className="text-[0.72rem] mt-1.5" style={{ color: "var(--muted-light)" }}>Tap to view transcript →</p>
                )}
              </div>
              {canEdit && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Edit details"
                  onClick={(e) => { e.stopPropagation(); onDetails(item.uid); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDetails(item.uid); } }}
                  className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full transition active:scale-95"
                  style={{ color: "var(--muted)", background: "var(--cream-dark)", cursor: "pointer" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </span>
              )}
              <span
                className={`text-[0.78rem] font-medium px-2.5 py-1 rounded-full shrink-0 ${badge.pulsing ? "dot-pulse" : ""}`}
                style={{ background: badge.bg, color: badge.fg }}
              >
                {badge.label}
              </span>
            </button>
          );
        })}
      </div>
      {showRetry && (
        <div className="px-6 mt-6 mb-8">
          <button
            onClick={onRetryFailed}
            className="w-full py-3.5 rounded-full font-medium text-[0.95rem] transition active:scale-[0.98]"
            style={{ background: "var(--burgundy)", color: "var(--cream)" }}
          >
            Retry all ({retryCount})
          </button>
        </div>
      )}
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────────────

export default function EnvoyApp() {
  const [screen, setScreen] = useState<"home" | "compose" | "invoice-compose" | "bulk-invoice" | "select-invoice" | "bulk-summary" | "live" | "detail">("home");
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [reviewBulkUid, setReviewBulkUid] = useState<string | null>(null);
  const [summaryEditUid, setSummaryEditUid] = useState<string | null>(null);
  const [returnToBulk, setReturnToBulk] = useState(false);
  const [returnToSummary, setReturnToSummary] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveInvoiceFile[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const bulkItemsRef = useRef<BulkItem[]>([]);
  useEffect(() => { bulkItemsRef.current = bulkItems; }, [bulkItems]);

  const fetchCalls = useCallback(async () => {
    try {
      const r = await fetch("/api/calls", { cache: "no-store" });
      const data = await r.json();
      setCalls(data.calls ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDriveFiles = useCallback(async () => {
    setDriveLoading(true);
    setDriveError(null);
    try {
      const r = await fetch("/api/drive/invoices", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setDriveFiles(data.files ?? []);
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : "Failed to load Drive files");
    } finally {
      setDriveLoading(false);
    }
  }, []);

  const getBulkItemFile = async (item: BulkItem): Promise<File> => {
    if (item.file) return item.file;
    const r = await fetch(`/api/drive/invoice-file?fileId=${item.driveFileId}`);
    if (!r.ok) throw new Error(`Failed to download ${item.fileName} (HTTP ${r.status})`);
    const blob = await r.blob();
    return new File([blob], item.fileName, { type: "application/pdf" });
  };

  const toggleDriveItem = (driveFile: DriveInvoiceFile) => {
    setBulkItems((prev) => {
      const existing = prev.find((i) => i.driveFileId === driveFile.fileId);
      if (existing) return prev.filter((i) => i.driveFileId !== driveFile.fileId);
      return [...prev, {
        uid: crypto.randomUUID(),
        source: "drive" as BulkSource,
        driveFileId: driveFile.fileId,
        fileName: driveFile.name,
        fileSize: driveFile.size,
        modifiedTime: driveFile.modifiedTime,
        status: "parsing" as BulkStatus,
      }];
    });
  };

  const selectAllDrive = () => {
    setBulkItems((prev) => {
      const existing = new Set(prev.filter((i) => i.source === "drive").map((i) => i.driveFileId));
      const additions: BulkItem[] = driveFiles
        .filter((f) => !existing.has(f.fileId))
        .map((f) => ({
          uid: crypto.randomUUID(),
          source: "drive" as BulkSource,
          driveFileId: f.fileId,
          fileName: f.name,
          fileSize: f.size,
          modifiedTime: f.modifiedTime,
          status: "parsing" as BulkStatus,
        }));
      return [...prev, ...additions];
    });
  };

  const deselectAllDrive = () => {
    setBulkItems((prev) => prev.filter((i) => i.source !== "drive"));
  };



  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  // Poll call status for dispatched bulk items
  useEffect(() => {
    const id = setInterval(async () => {
      const active = bulkItemsRef.current.filter(
        (i) => i.callId && i.callStatus !== "completed" && i.callStatus !== "failed"
      );
      if (active.length === 0) return;
      await Promise.all(active.map(async (item) => {
        try {
          const r = await fetch(`/api/calls/${item.callId}`, { cache: "no-store" });
          if (!r.ok) {
            setBulkItems((prev) => prev.map((i) =>
              i.uid === item.uid ? { ...i, callPollError: `Status check failed (HTTP ${r.status})` } : i
            ));
            return;
          }
          const data = await r.json();
          setBulkItems((prev) => prev.map((i) =>
            i.uid === item.uid
              ? { ...i, callStatus: data.status, callOutcome: data.outcome, callPollError: data.pollError ?? null }
              : i
          ));
        } catch { /* ignore */ }
      }));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const dispatch = async (brief: any) => {
    const r = await fetch("/api/calls/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brief),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error ?? `HTTP ${r.status}`);
    }
    const data = await r.json();
    setActiveCallId(data.id);
    setScreen("live");
  };

  const parseBulkItem = async (uid: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append("document", file);
      const r = await fetch("/api/calls/parse-document", { method: "POST", body: formData });
      const payload = await r.json() as InvoiceParseResult & { error?: string };
      if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);

      // Fallback: if the PDF had no callable number, try the contacts DB
      // (mirrors handleParseSuccess in the single-invoice flow)
      let resolved = payload;
      if (!hasCallableNumber(payload.toNumber)) {
        try {
          const params = new URLSearchParams();
          if (payload.contactBusiness) params.set("contactBusiness", payload.contactBusiness);
          if (payload.invoiceNumber) params.set("invoiceNumber", payload.invoiceNumber);
          if ([...params.keys()].length > 0) {
            const lr = await fetch(`/api/contacts/lookup?${params}`);
            if (lr.ok) {
              const data = (await lr.json()) as { phone: string | null };
              if (data.phone) resolved = { ...payload, toNumber: data.phone };
            }
          }
        } catch {
          // non-blocking — leave number empty, user can fill via Details
        }
      }
      setBulkItems((prev) => prev.map((i) => i.uid === uid ? { ...i, status: "parsed", parsed: resolved } : i));
    } catch (err) {
      setBulkItems((prev) => prev.map((i) => i.uid === uid ? { ...i, status: "parse-error", error: err instanceof Error ? err.message : "Parse failed" } : i));
    }
  };

  const handleBulkFiles = (files: File[]) => {
    setScreen("bulk-invoice");
    setBulkItems((prev) => {
      const seen = new Set(prev.map((i) => `${i.fileName}::${i.fileSize ?? ""}`));
      const newItems: BulkItem[] = [];
      for (const file of files) {
        const key = `${file.name}::${file.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        newItems.push({ uid: crypto.randomUUID(), source: "upload", file, fileName: file.name, fileSize: file.size, status: "parsing" as BulkStatus });
      }
      newItems.forEach((item) => parseBulkItem(item.uid, item.file!));
      return [...prev, ...newItems];
    });
  };

  const handleBulkFilesFromHome = (files: File[]) => {
    const seen = new Set<string>();
    const newItems: BulkItem[] = [];
    for (const file of files) {
      const key = `${file.name}::${file.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      newItems.push({ uid: crypto.randomUUID(), source: "upload", file, fileName: file.name, fileSize: file.size, status: "parsing" as BulkStatus });
    }
    setBulkItems(newItems);
    setScreen("bulk-invoice");
    newItems.forEach((item) => parseBulkItem(item.uid, item.file!));
  };

  const handleRemoveBulkItem = (uid: string) => {
    setBulkItems((prev) => prev.filter((i) => i.uid !== uid));
  };

  const openBulkCallDetail = async (callId: string) => {
    await fetchCalls();
    setActiveCallId(callId);
    setReturnToBulk(true);
    setScreen("detail");
  };

  const dispatchBulkItem = async (uid: string): Promise<false | void> => {
    const item = bulkItemsRef.current.find((i) => i.uid === uid);
    if (!item?.parsed || !hasCallableNumber(item.parsed.toNumber)) return;
    setBulkItems((prev) => prev.map((i) => i.uid === uid ? { ...i, status: "dispatching" } : i));
    try {
      const r = await fetch("/api/calls/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBulkBrief(item.parsed)),
      });
      if (r.status === 429) {
        // Server at capacity — reset so the drain loop can retry this item
        setBulkItems((prev) => prev.map((i) => i.uid === uid ? { ...i, status: "parsed" } : i));
        return false;
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json();
      setBulkItems((prev) => prev.map((i) => i.uid === uid ? { ...i, status: "dispatched", callId: data.id } : i));
    } catch (err) {
      setBulkItems((prev) => prev.map((i) => i.uid === uid ? { ...i, status: "dispatch-error", error: err instanceof Error ? err.message : "Dispatch failed" } : i));
    }
  };

  const openBulkDetails = (uid: string) => {
    setReviewBulkUid(uid);
    setScreen("invoice-compose");
  };

  const bulkDetailsDispatch = async (brief: any) => {
    const uid = reviewBulkUid;
    if (!uid) throw new Error("No bulk item selected");
    const r = await fetch("/api/calls/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brief),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error ?? `HTTP ${r.status}`);
    }
    const data = await r.json();
    setBulkItems((prev) => prev.map((i) => i.uid === uid ? { ...i, status: "dispatched", callId: data.id } : i));
    setReviewBulkUid(null);
    setScreen("bulk-invoice");
  };

  const saveBulkDetails = (state: BulkFormState) => {
    const uid = reviewBulkUid;
    if (uid) {
      setBulkItems((prev) => prev.map((i) => {
        if (i.uid !== uid || !i.parsed) return i;
        return {
          ...i,
          parsed: {
            ...i.parsed,
            toNumber: hasCallableNumber(state.toNumber) ? state.toNumber.trim() : null,
            contactBusiness: state.contactBusiness || null,
            contactPerson: state.contactPerson || null,
            vendorName: state.vendorName || null,
            invoiceNumber: state.invoiceNumber || null,
            invoiceDate: state.invoiceDate || null,
            dueDate: state.dueDate || null,
            amountDue: state.amountDue.trim() ? Number(state.amountDue) : null,
            currency: state.currency || null,
            lineItems: state.lineItems || null,
            invoiceNotes: state.invoiceNotes || null,
            bankName: state.bankName || null,
            bsb: state.bsb || null,
            accountNumber: state.accountNumber || null,
            swiftCode: state.swiftCode || null,
            abn: state.abn || null,
            remittanceName: state.remittanceName || null,
            remittanceContact: state.remittanceContact || null,
          },
        };
      }));
    }
    setReviewBulkUid(null);
    setScreen("bulk-invoice");
  };

  const closeBulkDetails = () => {
    setReviewBulkUid(null);
    setScreen("bulk-invoice");
  };

  const openSummaryDetails = (uid: string) => {
    const next = bulkItemsRef.current.map((i) =>
      i.uid === uid ? { ...i, status: "paused" as BulkStatus, error: undefined } : i
    );
    bulkItemsRef.current = next;
    setBulkItems(next);
    setSummaryEditUid(uid);
  };

  const saveSummaryDetails = (state: BulkFormState) => {
    const uid = summaryEditUid;
    if (uid) {
      setBulkItems((prev) => prev.map((i) => {
        if (i.uid !== uid || !i.parsed) return i;
        return {
          ...i,
          status: "paused" as BulkStatus,
          parsed: {
            ...i.parsed,
            toNumber: hasCallableNumber(state.toNumber) ? state.toNumber.trim() : null,
            contactBusiness: state.contactBusiness || null,
            contactPerson: state.contactPerson || null,
            vendorName: state.vendorName || null,
            invoiceNumber: state.invoiceNumber || null,
            invoiceDate: state.invoiceDate || null,
            dueDate: state.dueDate || null,
            amountDue: state.amountDue.trim() ? Number(state.amountDue) : null,
            currency: state.currency || null,
            lineItems: state.lineItems || null,
            invoiceNotes: state.invoiceNotes || null,
            bankName: state.bankName || null,
            bsb: state.bsb || null,
            accountNumber: state.accountNumber || null,
            swiftCode: state.swiftCode || null,
            abn: state.abn || null,
            remittanceName: state.remittanceName || null,
            remittanceContact: state.remittanceContact || null,
          },
        };
      }));
    }
    setSummaryEditUid(null);
  };

  const summaryDetailsDispatch = async (brief: any) => {
    const uid = summaryEditUid;
    if (!uid) throw new Error("No bulk item selected");
    setBulkItems((prev) => prev.map((i) =>
      i.uid === uid ? { ...i, status: "dispatching" as BulkStatus, error: undefined } : i
    ));
    const r = await fetch("/api/calls/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brief),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      setBulkItems((prev) => prev.map((i) =>
        i.uid === uid ? { ...i, status: "paused" as BulkStatus } : i
      ));
      throw new Error(e.error ?? `HTTP ${r.status}`);
    }
    const data = await r.json();
    setBulkItems((prev) => prev.map((i) =>
      i.uid === uid ? { ...i, status: "dispatched" as BulkStatus, callId: data.id } : i
    ));
    setSummaryEditUid(null);
  };

  // Shared drain loop: dispatches items currently in "parsed" state with a phone.
  // Returns when queue is empty. Called by both old bulk screen and new select-invoice flow.
  const drainDispatch = async () => {
    const toDispatch = bulkItemsRef.current.filter(
      (i) => i.status === "parsed" && hasCallableNumber(i.parsed?.toNumber)
    );
    if (toDispatch.length === 0) return;
    const queue = [...toDispatch];
    const retries = new Map<string, number>();
    const RETRY_WAIT = 2_000;
    const MAX_RETRIES = 8;
    while (queue.length > 0) {
      const item = queue[0];
      const result = await dispatchBulkItem(item.uid);
      if (result === false) {
        const n = (retries.get(item.uid) ?? 0) + 1;
        retries.set(item.uid, n);
        if (n >= MAX_RETRIES) {
          setBulkItems((prev) => prev.map((i) =>
            i.uid === item.uid ? { ...i, status: "dispatch-error", error: "Server at capacity — try again shortly" } : i
          ));
          queue.shift();
          retries.delete(item.uid);
        } else {
          await new Promise((r) => setTimeout(r, RETRY_WAIT));
        }
        continue;
      }
      queue.shift();
      retries.delete(item.uid);
      if (queue.length > 0) await new Promise((r) => setTimeout(r, 1_000));
    }
  };

  const handleDispatchAll = async () => {
    const ready = bulkItemsRef.current.filter(
      (i) => i.status === "parsed" && hasCallableNumber(i.parsed?.toNumber)
    );
    if (ready.length === 0) return;
    setIsDispatching(true);
    try {
      await drainDispatch();
    } finally {
      setIsDispatching(false);
    }
  };

  // Parse → resolve phone → dispatch for each item as soon as it's ready.
  // Contacts are pre-loaded once so each item can dispatch immediately after parsing
  // without waiting for all other items to finish.
  const runInvoicePipeline = async (uids: string[]) => {
    const uidSet = new Set(uids);
    const targets = bulkItemsRef.current.filter((i) => uidSet.has(i.uid));

    // 1. Pre-load contact rows so each item can resolve its phone immediately after parsing.
    let contactRows: ContactRow[] = [];
    try {
      const cr = await fetch("/api/drive/contacts", { cache: "no-store" });
      if (cr.ok) contactRows = (await cr.json()).rows ?? [];
    } catch {}

    // 2. Parse each item concurrently (capped); resolve phone and dispatch as soon as each is done.
    const parsedResults = new Map<string, InvoiceParseResult>();
    const sem = createSemaphore(CONCURRENT_CALL_LIMIT);
    await Promise.all(targets.map((item) => sem(async () => {
      if (bulkItemsRef.current.find((i) => i.uid === item.uid)?.status !== "paused") {
        setBulkItems((prev) => prev.map((i) => i.uid === item.uid ? { ...i, status: "parsing" } : i));
      }
      try {
        const file = await getBulkItemFile(item);
        const formData = new FormData();
        formData.append("document", file);
        const r = await fetch("/api/calls/parse-document", { method: "POST", body: formData });
        const payload = await r.json() as InvoiceParseResult & { error?: string };
        if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
        parsedResults.set(item.uid, payload);

        // Resolve phone immediately from pre-loaded contacts or PDF.
        const match = contactRows.find((row) => companyNamesMatch(row.businessName, payload.contactBusiness ?? ""));
        const sheetPhone = match?.phone || null;
        const pdfPhone = hasCallableNumber(payload.toNumber) ? payload.toNumber : null;
        const phone = sheetPhone ?? pdfPhone;
        const person = match?.contactPerson || payload.contactPerson || null;

        if (!phone) {
          const updated: BulkItem = {
            ...item,
            status: "dispatch-error",
            error: "No phone number found — add it to the spreadsheet",
            phoneSource: "none",
            parsed: payload,
          };
          bulkItemsRef.current = bulkItemsRef.current.map((i) => i.uid === item.uid ? updated : i);
          setBulkItems((prev) => prev.map((i) => i.uid === item.uid ? updated : i));
          return;
        }

        // Preserve "paused" if the user clicked the icon while this item was parsing.
        const wasPaused = bulkItemsRef.current.find((i) => i.uid === item.uid)?.status === "paused";
        const resolved: BulkItem = {
          ...item,
          status: wasPaused ? "paused" : "parsed",
          parsed: { ...payload, toNumber: phone, contactPerson: person },
          phoneSource: sheetPhone ? "spreadsheet" : "pdf",
        };
        bulkItemsRef.current = bulkItemsRef.current.map((i) => i.uid === item.uid ? resolved : i);
        setBulkItems((prev) => prev.map((i) => i.uid === item.uid ? resolved : i));

        // Dispatch immediately with backpressure retry.
        const RETRY_WAIT = 2_000;
        const MAX_RETRIES = 8;
        let attempts = 0;
        while (true) {
          // Honor a pause requested while this item was parsing/queued.
          if (bulkItemsRef.current.find((i) => i.uid === item.uid)?.status === "paused") return;
          const result = await dispatchBulkItem(item.uid);
          if (result !== false) break;
          attempts++;
          if (attempts >= MAX_RETRIES) {
            setBulkItems((prev) => prev.map((i) =>
              i.uid === item.uid ? { ...i, status: "dispatch-error", error: "Server at capacity — try again shortly" } : i
            ));
            break;
          }
          await new Promise((res) => setTimeout(res, RETRY_WAIT));
        }
      } catch (err) {
        setBulkItems((prev) => prev.map((i) => i.uid === item.uid
          ? { ...i, status: "parse-error", error: err instanceof Error ? err.message : "Read failed" }
          : i
        ));
      }
    })));

    // 3. Sync newly-discovered businesses to the spreadsheet for future use.
    const discovered = Array.from(parsedResults.values())
      .filter((p) => p.contactBusiness)
      .map((p) => ({
        businessName: p.contactBusiness!,
        abn: p.abn ?? null,
        contactPerson: p.contactPerson ?? null,
      }));
    if (discovered.length > 0) {
      fetch("/api/drive/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: discovered }),
      }).catch((e) => console.error("[contacts sync] fetch error:", e));
    }
  };

  // One-click dispatch from SelectInvoiceScreen.
  // selectedUploadFiles are the files the user checked in the upload tab — they haven't
  // been added to bulkItems yet, so we insert them (and the ref) synchronously first.
  const handleSelectInvoiceDispatch = async (selectedUploadFiles: File[] = []) => {
    if (selectedUploadFiles.length > 0) {
      const seen = new Set(bulkItemsRef.current.map((i) => `${i.fileName}::${i.fileSize ?? ""}`));
      const newItems: BulkItem[] = selectedUploadFiles
        .filter((f) => !seen.has(`${f.name}::${f.size}`))
        .map((f) => ({
          uid: crypto.randomUUID(),
          source: "upload" as BulkSource,
          file: f,
          fileName: f.name,
          fileSize: f.size,
          status: "parsing" as BulkStatus,
        }));
      bulkItemsRef.current = [...bulkItemsRef.current, ...newItems];
      setBulkItems(bulkItemsRef.current);
    }
    if (bulkItemsRef.current.length === 0) return;
    setScreen("bulk-summary");
    setIsDispatching(true);
    try {
      await runInvoicePipeline(bulkItemsRef.current.map((i) => i.uid));
    } finally {
      setIsDispatching(false);
    }
  };

  // Retry failed items from BulkSummaryScreen
  const handleRetryFailed = async () => {
    const items = bulkItemsRef.current;
    const failed = (i: BulkItem) => i.status === "dispatch-error" || i.callStatus === "failed";
    // Items that already have a resolved phone but failed to dispatch or are paused → just re-drain.
    const redriveUids = items
      .filter((i) => (failed(i) || i.status === "paused") && i.parsed && hasCallableNumber(i.parsed.toNumber))
      .map((i) => i.uid);
    // Items needing full re-processing: parse errors, "no phone" failures, or paused items whose
    // phone was blanked during editing (re-resolve from the sheet).
    const reprocessUids = items
      .filter((i) =>
        i.status === "parse-error" ||
        (failed(i) && !(i.parsed && hasCallableNumber(i.parsed.toNumber))) ||
        (i.status === "paused" && !(i.parsed && hasCallableNumber(i.parsed.toNumber)))
      )
      .map((i) => i.uid);
    if (!redriveUids.length && !reprocessUids.length) return;
    setIsDispatching(true);
    try {
      if (redriveUids.length > 0) {
        const set = new Set(redriveUids);
        const next = bulkItemsRef.current.map((i) =>
          set.has(i.uid)
            ? { ...i, status: "parsed" as BulkStatus, error: undefined, callId: undefined, callStatus: undefined, callOutcome: undefined }
            : i
        );
        bulkItemsRef.current = next;
        setBulkItems(next);
        await drainDispatch();
      }
      if (reprocessUids.length > 0) {
        await runInvoicePipeline(reprocessUids);
      }
    } finally {
      setIsDispatching(false);
    }
  };

  const activeCall = calls.find((c) => c.id === activeCallId) ?? null;

  return (
    <div className="max-w-md mx-auto min-h-screen relative" style={{ background: "var(--cream)", zIndex: 2 }}>
      {screen === "home" && (
        <Home
          calls={calls}
          loading={loading}
          onNewCall={() => setScreen("compose")}
          onUploadInvoice={() => { setBulkItems([]); setScreen("select-invoice"); loadDriveFiles(); }}
          onSelectCall={(id) => { setActiveCallId(id); setReturnToBulk(false); setReturnToSummary(false); setScreen("detail"); }}
          onRefresh={fetchCalls}
        />
      )}
      {screen === "compose" && (
        <Compose onCancel={() => setScreen("home")} onPlace={dispatch} />
      )}
      {screen === "invoice-compose" && (
        <InvoiceCompose
          key={reviewBulkUid ? `bulk-${reviewBulkUid}` : "single-invoice"}
          onCancel={reviewBulkUid ? closeBulkDetails : () => setScreen("home")}
          onPlace={reviewBulkUid ? bulkDetailsDispatch : dispatch}
          preloaded={reviewBulkUid ? { parsed: bulkItems.find((i) => i.uid === reviewBulkUid)!.parsed! } : undefined}
          onBulkFiles={handleBulkFilesFromHome}
          onBackWithState={reviewBulkUid ? saveBulkDetails : undefined}
        />
      )}
      {screen === "bulk-invoice" && (
        <BulkInvoiceScreen
          items={bulkItems}
          onAddFiles={handleBulkFiles}
          onDetails={openBulkDetails}
          onDispatch={dispatchBulkItem}
          onDispatchAll={handleDispatchAll}
          onRemove={handleRemoveBulkItem}
          onViewDetail={openBulkCallDetail}
          isDispatching={isDispatching}
          onRetry={(uid) => {
            const item = bulkItems.find((i) => i.uid === uid);
            if (item?.file) {
              setBulkItems((prev) => prev.map((i) => i.uid === uid ? { ...i, status: "parsing", error: undefined } : i));
              parseBulkItem(uid, item.file);
            }
          }}
          onBack={() => setScreen("home")}
        />
      )}
      {screen === "live" && activeCallId && (
        <Live
          callId={activeCallId}
          onDone={() => { fetchCalls(); setScreen("home"); setActiveCallId(null); }}
          onViewDetail={() => { fetchCalls(); setReturnToBulk(false); setScreen("detail"); }}
        />
      )}
      {screen === "detail" && activeCall && (
        <Detail
          call={activeCall}
          onBack={() => {
            if (returnToSummary) {
              setReturnToSummary(false);
              setActiveCallId(null);
              setScreen("bulk-summary");
            } else if (returnToBulk) {
              setReturnToBulk(false);
              setActiveCallId(null);
              setScreen("bulk-invoice");
            } else {
              setScreen("home");
              setActiveCallId(null);
            }
          }}
        />
      )}
      {screen === "select-invoice" && (
        <SelectInvoiceScreen
          driveFiles={driveFiles}
          driveLoading={driveLoading}
          driveError={driveError}
          queue={bulkItems}
          dispatching={isDispatching}
          onToggleDrive={toggleDriveItem}
          onSelectAllDrive={selectAllDrive}
          onDeselectAllDrive={deselectAllDrive}
          onDispatch={handleSelectInvoiceDispatch}
          onBack={() => { setBulkItems([]); setScreen("home"); }}
        />
      )}
      {screen === "bulk-summary" && (
        <BulkSummaryScreen
          items={bulkItems}
          onViewDetail={async (callId) => { await fetchCalls(); setActiveCallId(callId); setReturnToSummary(true); setScreen("detail"); }}
          onDetails={openSummaryDetails}
          onBack={() => { fetchCalls(); setBulkItems([]); setScreen("home"); }}
          onRetryFailed={handleRetryFailed}
        />
      )}
      {screen === "bulk-summary" && summaryEditUid && (() => {
        const editItem = bulkItems.find((i) => i.uid === summaryEditUid);
        return (
          <div className="absolute inset-0" style={{ background: "var(--cream)", zIndex: 3 }}>
            {editItem?.parsed ? (
              <InvoiceCompose
                key={`summary-${summaryEditUid}`}
                onCancel={() => setSummaryEditUid(null)}
                onPlace={summaryDetailsDispatch}
                preloaded={{ parsed: editItem.parsed }}
                onBackWithState={saveSummaryDetails}
              />
            ) : (
              <div className="min-h-screen flex flex-col items-center justify-center gap-3 pb-24">
                <div
                  className="w-5 h-5 rounded-full border-2 animate-spin"
                  style={{ borderColor: "var(--hairline)", borderTopColor: "var(--ink)" }}
                />
                <p className="text-[0.88rem]" style={{ color: "var(--muted)" }}>Reading invoice…</p>
                <button
                  onClick={() => setSummaryEditUid(null)}
                  className="mt-2 text-[0.82rem]"
                  style={{ color: "var(--muted)" }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
