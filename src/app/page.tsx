"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────

type Outcome = "success" | "partial" | "failed" | "no-answer" | null;
type Status = "dispatching" | "ringing" | "in-progress" | "completed" | "failed";

interface TranscriptLine {
  who: "envoy" | "them";
  text: string;
}

interface Call {
  id: string;
  contactName: string;
  toNumber: string;
  objective: string;
  status: Status;
  outcome: Outcome;
  result: string | null;
  summary: string | null;
  durationSec: number | null;
  transcript: TranscriptLine[];
  recordingUrl: string | null;
  createdAt: string;
}

interface InvoiceParseResult {
  vendorName?: string | null;
  contactName: string | null;
  toNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amountDue: number | null;
  currency: string | null;
  lineItems: string | null;
  invoiceNotes: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const fmtDuration = (s: number | null | undefined) => {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
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

const outcomeStyle = (o: Outcome) => {
  if (o === "success") return { bg: "var(--success-tint)", fg: "var(--success)", label: "Resolved" };
  if (o === "partial") return { bg: "var(--warning-tint)", fg: "var(--warning)", label: "Partial" };
  if (o === "no-answer") return { bg: "var(--burgundy-tint)", fg: "var(--burgundy)", label: "No answer" };
  if (o === "failed") return { bg: "var(--burgundy-tint)", fg: "var(--burgundy)", label: "Failed" };
  return { bg: "var(--cream-dark)", fg: "var(--muted)", label: "—" };
};

const statusLabel = (s: Status) => {
  if (s === "dispatching") return "Dispatching";
  if (s === "ringing") return "Ringing";
  if (s === "in-progress") return "In conversation";
  if (s === "completed") return "Completed";
  if (s === "failed") return "Failed";
  return s;
};

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
  const partial = calls.filter((c) => c.outcome === "partial").length;
  const totalSec = calls.reduce((s, c) => s + (c.durationSec ?? 0), 0);

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

        <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>
          {loading ? "Loading…" : calls.length === 0 ? "No calls yet" : `${calls.length} ${calls.length === 1 ? "call" : "calls"}`}
        </p>
        <h1 className="font-display text-[2.6rem] leading-[1.05] font-light tracking-tight">
          {calls.length === 0 ? (
            <>Place your<br/><span className="italic font-normal" style={{ color: "var(--burgundy)" }}>first call.</span></>
          ) : (
            <>{calls.length} {calls.length === 1 ? "call" : "calls"}<br/><span className="italic font-normal" style={{ color: "var(--burgundy)" }}>so far.</span></>
          )}
        </h1>
      </header>

      <Hairline />

      <div className="grid grid-cols-3 px-6 py-5" style={{ borderBottom: "1px solid var(--hairline)" }}>
        <div>
          <div className="font-display text-[1.75rem] leading-none font-medium">{fmtDuration(totalSec)}</div>
          <div className="smallcaps mt-1.5" style={{ color: "var(--muted)" }}>Total time</div>
        </div>
        <div className="border-l border-r" style={{ borderColor: "var(--hairline)" }}>
          <div className="pl-4">
            <div className="font-display text-[1.75rem] leading-none font-medium">{resolved}</div>
            <div className="smallcaps mt-1.5" style={{ color: "var(--muted)" }}>Resolved</div>
          </div>
        </div>
        <div className="pl-4">
          <div className="font-display text-[1.75rem] leading-none font-medium">{partial}</div>
          <div className="smallcaps mt-1.5" style={{ color: "var(--muted)" }}>Partial</div>
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
                    {call.contactName}
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
              <path d="M12 16V4" />
              <path d="M7 9l5-5 5 5" />
              <path d="M20 16.5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-2" />
            </svg>
            Upload invoice
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
  const [voice, setVoice] = useState("marcus");
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

  const isValid = number.trim().length > 6 && objective.trim().length > 9 && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onPlace({
        contactName: contact || "Unknown contact",
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
            Contact <span style={{ color: "var(--muted-light)" }}>· optional</span>
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
            Your name <span style={{ color: "var(--muted-light)" }}>· how Envoy refers to you</span>
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

function InvoiceCompose({
  onCancel,
  onPlace,
}: {
  onCancel: () => void;
  onPlace: (b: any) => Promise<void>;
}) {
  const [stage, setStage] = useState<"upload" | "review">("upload");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [number, setNumber] = useState("+61 ");
  const [contact, setContact] = useState("");
  const [objective, setObjective] = useState("");
  const [voice, setVoice] = useState("marcus");
  const [manner, setManner] = useState("warm");
  const [userName, setUserName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amountDue, setAmountDue] = useState("");
  const [currency, setCurrency] = useState("");
  const [lineItems, setLineItems] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const isValid = number.trim().length > 6 && objective.trim().length > 9 && !submitting;

  const handleParseSuccess = (parsed: InvoiceParseResult) => {
    const nextInvoiceNumber = parsed.invoiceNumber ?? "";
    setContact(parsed.contactName ?? "");
    setNumber(parsed.toNumber ?? "+61 ");
    if (parsed.vendorName) setUserName(parsed.vendorName);
    setInvoiceNumber(nextInvoiceNumber);
    setInvoiceDate(parsed.invoiceDate ?? "");
    setDueDate(parsed.dueDate ?? "");
    setAmountDue(parsed.amountDue == null ? "" : String(parsed.amountDue));
    setCurrency(parsed.currency ?? "");
    setLineItems(parsed.lineItems ?? "");
    setInvoiceNotes(parsed.invoiceNotes ?? "");
    const objParts: string[] = ["Follow up on payment for invoice"];
    if (nextInvoiceNumber) objParts.push(nextInvoiceNumber);
    if (parsed.amountDue != null) {
      const amtStr = parsed.currency ? `${parsed.currency} ${parsed.amountDue}` : String(parsed.amountDue);
      objParts.push(`(${amtStr} outstanding)`);
    }
    if (parsed.dueDate) objParts.push(`— due ${parsed.dueDate}`);
    objParts.push(". Confirm whether payment has been made or is scheduled. If overdue, politely arrange a settlement date or payment plan.");
    setObjective(objParts.join(" "));
    setStage("review");
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
        contactName: contact || "Unknown contact",
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
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to dispatch");
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
              <label className="smallcaps mb-3 block" style={{ color: "var(--muted)" }}>
                PDF document
              </label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  setDocumentFile(e.target.files?.[0] ?? null);
                  setParseError(null);
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
                <strong className="block mb-1">Parsing failed</strong>
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
              {parsing ? "Parsing invoice..." : "Upload and parse invoice"}
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
                    onChange={(e) => setNumber(e.target.value)}
                    placeholder="+61 4..."
                    className="w-full pb-3 font-mono text-[1.2rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Contact name</label>
                  <input
                    type="text"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="e.g. Acme Pty Ltd"
                    className="w-full pb-3 text-[1.05rem] bg-transparent"
                    style={{ borderBottom: "1px solid var(--hairline-strong)", color: "var(--ink)" }}
                  />
                </div>

                <div>
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>
                    Your name <span style={{ color: "var(--muted-light)" }}>· how Envoy refers to you</span>
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
                  <label className="smallcaps mb-2.5 block" style={{ color: "var(--muted)" }}>Invoice notes</label>
                  <textarea
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    rows={4}
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
}: {
  callId: string;
  onDone: () => void;
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
            <span className="smallcaps" style={{ opacity: 0.8 }}>{statusLabel(status)}</span>
          </div>
        </div>

        <h2 className="font-display text-[1.85rem] leading-tight font-light tracking-tight mb-1">
          {call?.contactName ?? "…"}
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
              className={status === "dispatching" || status === "ringing" ? "pulse-ring" : ""}
              style={{
                width: 78, height: 78, borderRadius: 999,
                background: "var(--burgundy)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <WaveAnim active={status === "in-progress"} />
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
              {line.who === "envoy" ? "Envoy" : call.contactName.split(" ")[0]}
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
          onClick={onDone}
          className="w-full py-4 rounded-full text-[1rem] font-medium transition active:scale-[0.98]"
          style={{
            background: finished ? "var(--ink)" : "rgba(244,239,230,0.08)",
            border: finished ? "none" : "1px solid rgba(244,239,230,0.2)",
            color: "var(--cream)",
          }}
        >
          {finished ? "Done" : "Back to history"}
        </button>
      </div>
    </div>
  );
}

// ─── Detail ─────────────────────────────────────────────────────────────

function Detail({ call, onBack }: { call: Call; onBack: () => void }) {
  const oc = outcomeStyle(call.outcome);
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

        <h1 className="font-display text-[2rem] leading-tight font-light tracking-tight mb-1">{call.contactName}</h1>
        <p className="font-mono text-[0.85rem]" style={{ color: "var(--muted)" }}>{call.toNumber}</p>
      </header>

      <Hairline />

      {call.result && (
        <>
          <section className="px-6 py-7">
            <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>Outcome</p>
            <p className="font-display text-[1.4rem] leading-snug font-medium tracking-tight" style={{ color: "var(--burgundy)" }}>
              {call.result}
            </p>
          </section>
          <Hairline />
        </>
      )}

      <section className="px-6 py-6">
        <p className="smallcaps mb-2" style={{ color: "var(--muted)" }}>The brief</p>
        <p className="text-[1rem] leading-relaxed">{call.objective}</p>
      </section>

      {call.summary && (
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

      {call.transcript && call.transcript.length > 0 && (
        <>
          <Hairline />
          <section className="px-6 py-6">
            <p className="smallcaps mb-4" style={{ color: "var(--muted)" }}>Transcript</p>
            <div className="space-y-4">
              {call.transcript.map((line, i) => (
                <div key={i}>
                  <p className="smallcaps mb-1" style={{ color: line.who === "envoy" ? "var(--burgundy)" : "var(--muted)" }}>
                    {line.who === "envoy" ? "Envoy" : call.contactName.split(" ")[0]}
                  </p>
                  <p className="text-[0.95rem] leading-relaxed">{line.text}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {call.recordingUrl && (
        <>
          <Hairline />
          <section className="px-6 py-7">
            <a
              href={call.recordingUrl}
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

// ─── App ────────────────────────────────────────────────────────────────

export default function EnvoyApp() {
  const [screen, setScreen] = useState<"home" | "compose" | "invoice-compose" | "live" | "detail">("home");
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

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

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

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

  const activeCall = calls.find((c) => c.id === activeCallId) ?? null;

  return (
    <div className="max-w-md mx-auto min-h-screen relative" style={{ background: "var(--cream)", zIndex: 2 }}>
      {screen === "home" && (
        <Home
          calls={calls}
          loading={loading}
          onNewCall={() => setScreen("compose")}
          onUploadInvoice={() => setScreen("invoice-compose")}
          onSelectCall={(id) => { setActiveCallId(id); setScreen("detail"); }}
          onRefresh={fetchCalls}
        />
      )}
      {screen === "compose" && (
        <Compose onCancel={() => setScreen("home")} onPlace={dispatch} />
      )}
      {screen === "invoice-compose" && (
        <InvoiceCompose onCancel={() => setScreen("home")} onPlace={dispatch} />
      )}
      {screen === "live" && activeCallId && (
        <Live
          callId={activeCallId}
          onDone={() => { fetchCalls(); setScreen("home"); setActiveCallId(null); }}
        />
      )}
      {screen === "detail" && activeCall && (
        <Detail call={activeCall} onBack={() => { setScreen("home"); setActiveCallId(null); }} />
      )}
    </div>
  );
}
