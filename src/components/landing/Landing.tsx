'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { RotatingGlobe } from './Globe';
import { IconEnvoy } from '@/components/shared/Icons';
import { IsoftLogo } from '@/components/shared/Logo';

// ── Pre-login marketing landing for Envoy (outbound). Copy/structure from the Envoy
// pitch handoff; visual language + globe ported from the sibling EnvoyIn app. The single
// "Launch app" CTA routes to /app/dashboard (middleware handles the auth/onboarding gate).

// Two distinct doors, deliberately. LOGIN is for people who already have an account
// (owners, and employees who redeemed their invite); SIGNUP creates a new company. A
// single "Launch app" CTA used to hide that distinction behind an auth redirect, which is
// how employees ended up on a page that only offered to sign them up.
const LOGIN = '/login';
const SIGNUP = '/signup';

// ── Scroll reveal ───────────────────────────────────────────────────────────
function Reveal({ children, variant = 'up', delay = 0, className = '' }: { children: React.ReactNode; variant?: 'up' | 'left' | 'right' | 'scale' | 'blur'; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setTimeout(() => el.classList.add('reveal-in'), delay);
          io.unobserve(el);
        }
      },
      { threshold: 0.18 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return <div ref={ref} className={`reveal reveal-${variant} ${className}`}>{children}</div>;
}

// ── Count-up number ─────────────────────────────────────────────────────────
function Counter({ to, prefix = '', suffix = '', decimals = 0 }: { to: number; prefix?: string; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.unobserve(el);
        const start = performance.now();
        const dur = 1100;
        function tick(now: number) {
          const p = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          setVal(to * eased);
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      },
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <span ref={ref} className="tabular-nums">{prefix}{val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

// ── Sticky top nav ──────────────────────────────────────────────────────────
function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/85 backdrop-blur-md border-b border-slate-200/70 py-3' : 'py-5'}`}>
      <div className="max-w-[1200px] mx-auto px-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <IconEnvoy className="w-7 h-7" />
          <span className={`font-bold text-lg tracking-tight ${scrolled ? 'text-slate-900' : 'text-white'}`}>Envoy<span className="text-brand">.</span></span>
        </div>
        <div className={`hidden md:flex items-center gap-7 text-sm font-medium ${scrolled ? 'text-slate-600' : 'text-white/80'}`}>
          <a href="#how" className="hover:text-brand transition-colors">How it works</a>
          <a href="#board" className="hover:text-brand transition-colors">Live board</a>
          <a href="#demo" className="hover:text-brand transition-colors">See a call</a>
          <a href="#uses" className="hover:text-brand transition-colors">Use cases</a>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={LOGIN}
            className={`text-sm font-medium hover:text-brand transition-colors ${scrolled ? 'text-slate-600' : 'text-white/80'}`}
          >
            Log in
          </Link>
          <Link href={SIGNUP} className="landing-cta-sm">Get started</Link>
        </div>
      </div>
    </nav>
  );
}

// ── Section shell ───────────────────────────────────────────────────────────
function Kicker({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={`text-[13px] font-semibold uppercase tracking-[0.22em] mb-4 ${dark ? 'text-[#F0B4BF]' : 'text-brand'}`}>{children}</p>;
}

// ── Live board mock (rotating demo data) ────────────────────────────────────
const MOCK_COMPANIES = ['City Motors', 'Harbrook Ltd', 'Delta Freight', 'Ora Health', 'Pinehill Cafe', 'Vertex Print', 'Blue Ridge Co', 'Nova Traders', 'Kestrel Group'];
type MockCard = { id: number; company: string; amount: number; tag: 'Queued' | 'On call' | 'Paid' | 'Promised' };
const TAG_CLS: Record<MockCard['tag'], string> = {
  Queued: 'bg-[#fdeecf] text-[#8a6d12]',
  'On call': 'bg-[#dcefff] text-[#155e8a]',
  Paid: 'bg-[#d8f3e4] text-[#146c46]',
  Promised: 'bg-[#efe0f6] text-[#6b2d8a]',
};
let mockSeq = 100;
function randCard(tag: MockCard['tag']): MockCard {
  return { id: ++mockSeq, company: MOCK_COMPANIES[Math.floor(Math.random() * MOCK_COMPANIES.length)], amount: Math.round((500 + Math.random() * 8000) / 10) * 10, tag };
}

// Deterministic seed so server + client render identical HTML (no hydration mismatch);
// the interval below then mutates it with randomised cards, client-side only.
const INITIAL_COLS = {
  queued: [
    { id: 1, company: 'Harbrook Ltd', amount: 3240, tag: 'Queued' as const },
    { id: 2, company: 'Delta Freight', amount: 1180, tag: 'Queued' as const },
    { id: 3, company: 'Pinehill Cafe', amount: 640, tag: 'Queued' as const },
  ],
  progress: [
    { id: 4, company: 'City Motors', amount: 4200, tag: 'On call' as const },
    { id: 5, company: 'Ora Health', amount: 2760, tag: 'On call' as const },
  ],
  resolved: [
    { id: 6, company: 'Vertex Print', amount: 5310, tag: 'Paid' as const },
    { id: 7, company: 'Nova Traders', amount: 890, tag: 'Promised' as const },
    { id: 8, company: 'Blue Ridge Co', amount: 2050, tag: 'Paid' as const },
  ],
};

function LiveBoardMock() {
  const [cols, setCols] = useState<{ queued: MockCard[]; progress: MockCard[]; resolved: MockCard[] }>(INITIAL_COLS);

  useEffect(() => {
    const iv = setInterval(() => {
      if (document.hidden) return;
      setCols((c) => {
        const progress = [...c.progress];
        const queued = [...c.queued];
        const resolved = [...c.resolved];
        // promote heads down the pipeline
        if (progress.length) {
          const done = progress.shift()!;
          resolved.unshift({ ...done, tag: Math.random() > 0.5 ? 'Paid' : 'Promised' });
        }
        if (queued.length) {
          const next = queued.shift()!;
          progress.push({ ...next, tag: 'On call' });
        }
        queued.push(randCard('Queued'));
        return { queued: queued.slice(0, 4), progress: progress.slice(0, 2), resolved: resolved.slice(0, 5) };
      });
    }, 2600);
    return () => clearInterval(iv);
  }, []);

  const column = (label: string, dot: string, cards: MockCard[]) => (
    <div className="flex-1 rounded-xl bg-slate-50 p-2.5 min-w-0">
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className="text-[11px] font-bold text-slate-600">{label}</span>
        <span className="ml-auto text-[10px] font-mono text-slate-400">{cards.length}</span>
      </div>
      <div className="space-y-1.5">
        {cards.map((card) => (
          <div key={card.id} className="bg-white rounded-lg border border-slate-100 px-2.5 py-2 shadow-sm animate-fade-in">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-800 truncate">{card.company}</span>
              <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${TAG_CLS[card.tag]}`}>{card.tag}</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">AU${card.amount.toLocaleString()} overdue</p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-[0_40px_90px_-50px_rgba(92,15,34,0.5)] overflow-hidden">
      {/* browser chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[11px] text-slate-400 font-mono">app.envoy.io/board</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
        </span>
      </div>
      {/* KPI row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-4 border-b border-slate-100">
        {[
          { label: 'Calls today', node: <Counter to={142} /> },
          { label: 'Recovered', node: <Counter to={38} prefix="AU$" suffix="k" />, accent: true },
          { label: 'Connect rate', node: <Counter to={68} suffix="%" /> },
          { label: 'Avg call', node: <>2:14</> },
        ].map((k) => (
          <div key={k.label}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{k.label}</p>
            <p className={`text-xl font-bold tabular-nums ${k.accent ? 'text-brand' : 'text-slate-900'}`}>{k.node}</p>
          </div>
        ))}
      </div>
      {/* kanban */}
      <div className="flex gap-3 p-4">
        {column('Queued', 'bg-amber-400', cols.queued)}
        {column('In progress', 'bg-blue-400', cols.progress)}
        {column('Resolved', 'bg-emerald-400', cols.resolved)}
      </div>
    </div>
  );
}

// ── Transcript demo (scripted playback) ─────────────────────────────────────
const SCRIPT: { who: 'ai' | 'them'; text: string }[] = [
  { who: 'ai', text: "Hi, this is Envoy calling on behalf of iSOFT about invoice #8847." },
  { who: 'them', text: 'Oh right — remind me of the amount?' },
  { who: 'ai', text: "It's AU$4,200, and it was due 14 days ago. I wanted to check whether payment has gone through." },
  { who: 'them', text: "Not yet, sorry. I can settle it this Friday." },
  { who: 'ai', text: 'Perfect — I\'ll note Friday. You\'ll get a confirmation by email. Thanks for your time.' },
];

function TranscriptDemo() {
  const [shown, setShown] = useState(0);
  const [decision, setDecision] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const play = useCallback(() => {
    if (started.current) return;
    started.current = true;
    let i = 0;
    const advance = () => {
      i += 1;
      setShown(i);
      if (i < SCRIPT.length) {
        setTimeout(advance, 700 + SCRIPT[i - 1].text.length * 22);
      } else {
        setTimeout(() => setDecision(true), 900);
      }
    };
    setShown(1);
    setTimeout(advance, 900);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { play(); io.unobserve(el); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [play]);

  return (
    <div ref={ref} className="rounded-2xl overflow-hidden border border-slate-200 shadow-[0_40px_90px_-50px_rgba(92,15,34,0.5)] bg-white">
      {/* call header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#5C0F22] text-[#F8EEF0]">
        <span className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-sm font-bold">E</span>
        <div>
          <p className="text-sm font-semibold leading-tight">Envoy</p>
          <p className="text-[11px] text-[#F0B4BF] flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> On call · City Motors</p>
        </div>
        <span className="ml-auto text-xs font-mono text-[#F0B4BF] tabular-nums">01:{String(Math.min(59, shown * 11)).padStart(2, '0')}</span>
      </div>
      {/* messages */}
      <div className="p-4 space-y-2.5 min-h-[280px] bg-slate-50/40">
        {SCRIPT.slice(0, shown).map((m, i) => (
          <div key={i} className={`flex ${m.who === 'ai' ? 'justify-start' : 'justify-end'} animate-fade-in`}>
            <div className={`max-w-[78%] text-sm leading-relaxed px-3.5 py-2 rounded-2xl ${m.who === 'ai' ? 'bg-white border border-slate-100 text-slate-700 rounded-bl-sm' : 'bg-brand text-white rounded-br-sm'}`}>
              {m.text}
            </div>
          </div>
        ))}
        {decision && (
          <div className="mt-4 rounded-xl border-2 border-dashed border-brand/40 bg-brand-faint/50 p-3.5 animate-fade-in">
            <p className="text-[11px] font-bold uppercase tracking-wider text-brand mb-1">Promise to pay · 96% confidence</p>
            <p className="text-sm text-slate-700">Invoice #8847 · AU$4,200 · 14 days overdue</p>
            <p className="text-xs text-slate-500 mt-1">Outcome logged · follow-up scheduled for Friday</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
const MARQUEE = ['Invoice collection', 'Payment reminders', 'Appointment confirmations', 'Renewal follow-ups', 'Customer surveys', 'Lead qualification'];
const STEPS = [
  { n: '01', title: 'Brief', body: 'Drop in an invoice or pick a contact. Envoy reads amount, due date, terms, and matches the right phone number automatically.' },
  { n: '02', title: 'Call', body: 'Dials, speaks naturally, handles objections, detects voicemail, never talks over anyone, defers when unsure.' },
  { n: '03', title: 'Report', body: 'Recording, transcript, AI summary, and a clear outcome — paid, promised, callback or escalate.' },
];
const USES = [
  { title: 'Invoice collection & AR', body: 'Chase overdue invoices politely and persistently — the lead use case.' },
  { title: 'Appointment confirmations', body: 'Confirm bookings and cut no-shows without staff picking up the phone.' },
  { title: 'Renewals & follow-ups', body: 'Nudge expiring contracts and re-engage lapsed customers on schedule.' },
  { title: 'Surveys & feedback', body: 'Collect structured feedback over a natural voice conversation.' },
];

export function Landing() {
  return (
    <div className="landing-root bg-white text-[#33272A]">
      <TopNav />

      {/* ── Hero ── */}
      <header className="hero-bg relative overflow-hidden">
        <div className="hero-orb hero-orb-1" />
        <div className="hero-orb hero-orb-2" />
        <div className="hero-grain" />
        <div className="absolute inset-0 dot-grid opacity-60" />
        <div className="relative max-w-[1200px] mx-auto px-6 pt-36 pb-24 grid lg:grid-cols-[1.05fr_.95fr] gap-12 items-center">
          <div>
            <p className="hero-stagger text-[13px] font-semibold uppercase tracking-[0.22em] text-[#F0B4BF] mb-5" style={{ animationDelay: '0.05s' }}>AI-powered outbound calling</p>
            <h1 className="hero-stagger font-display text-white font-bold leading-[1.02] tracking-tight" style={{ fontSize: 'clamp(44px, 6.5vw, 84px)', animationDelay: '0.15s' }}>
              Envoy makes the calls <span className="font-serif-accent italic font-normal text-white hero-accent-line">you keep putting off.</span>
            </h1>
            <p className="hero-stagger text-lg text-white/70 mt-6 max-w-xl leading-relaxed" style={{ animationDelay: '0.28s' }}>
              An AI agent that places outbound phone calls on your behalf — chasing overdue invoices, confirming appointments and following up — then reports back exactly what happened.
            </p>
            <div className="hero-stagger flex flex-wrap items-center gap-3 mt-8" style={{ animationDelay: '0.4s' }}>
              <Link href={SIGNUP} className="landing-cta">Get started <span aria-hidden>→</span></Link>
              <Link href={LOGIN} className="landing-cta-ghost">Log in</Link>
            </div>
            <p className="hero-stagger text-xs text-white/45 mt-4" style={{ animationDelay: '0.45s' }}>
              Setting up a company? Get started. Already on a team? Log in with the password you
              set from your invite email.
            </p>
            <div className="hero-stagger flex items-center gap-3 mt-10 text-white/60" style={{ animationDelay: '0.5s' }}>
              <span className="text-xs">Built &amp; operated in Australia by</span>
              <IsoftLogo className="h-5" white />
            </div>
          </div>
          <div className="hero-stagger flex justify-center lg:justify-end" style={{ animationDelay: '0.35s' }}>
            <RotatingGlobe size={520} />
          </div>
        </div>
        <div className="relative flex flex-col items-center pb-8 gap-2 text-white/40">
          <span className="text-[10px] uppercase tracking-[0.2em]">Scroll</span>
          <span className="w-px h-8 bg-white/30 animate-scroll-cue" />
        </div>
      </header>

      {/* ── Marquee ── */}
      <section className="border-y border-[#EADCDF] bg-[#FFFAF9] overflow-hidden">
        <div className="max-w-[1200px] mx-auto px-6 py-5 flex items-baseline gap-4">
          <span className="text-[13px] font-semibold uppercase tracking-[0.22em] text-brand whitespace-nowrap">One agent, every call</span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8A7B7E] whitespace-nowrap hidden sm:inline">Outbound · voice-first · always on</span>
        </div>
        <div className="relative py-4 overflow-hidden">
          <div className="marquee-track">
            {[...MARQUEE, ...MARQUEE].map((item, i) => (
              <span key={i} className="inline-flex items-center text-2xl md:text-3xl font-display font-semibold text-[#33272A]/80 px-6">
                {item} <span className="w-2 h-2 rounded-full bg-brand ml-6" />
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Problem (dark) ── */}
      <section className="bg-[#5C0F22] text-[#F8EEF0]">
        <div className="max-w-[1200px] mx-auto px-6 py-28">
          <Reveal><Kicker dark>The problem</Kicker></Reveal>
          <Reveal delay={80}><h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight max-w-2xl leading-[1.05]">The calls that never get made.</h2></Reveal>
          <Reveal delay={140}><p className="text-lg text-[#F8EEF0]/70 mt-5 max-w-xl">Chasing payments is uncomfortable, time-consuming and easy to defer. So it slips — and the money stays out.</p></Reveal>
          <div className="grid sm:grid-cols-3 gap-px mt-14 rounded-[18px] overflow-hidden bg-[rgba(248,238,240,0.14)]">
            {[
              { stat: <><span className="text-[#F0B4BF]">AU$</span><Counter to={76} suffix="B" /></>, note: 'currently owed to Australian SMBs in unpaid invoices.', src: 'getunpaid.io, 2026' },
              { stat: <Counter to={78} suffix=" hrs" />, note: 'a year the average SMB spends chasing overdue invoices — two working weeks.', src: 'GoCardless, 2026' },
              { stat: <Counter to={42} suffix="%" />, note: 'of SMB owners feel uncomfortable chasing payments.', src: 'Xero' },
            ].map((c, i) => (
              <Reveal key={i} delay={i * 90} className="bg-[#5C0F22] p-8">
                <p className="font-display text-5xl font-bold tracking-tight">{c.stat}</p>
                <p className="text-sm text-[#F8EEF0]/75 mt-3 leading-relaxed">{c.note}</p>
                <p className="text-xs text-[#F8EEF0]/40 mt-2">{c.src}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="bg-white">
        <div className="max-w-[1200px] mx-auto px-6 py-28">
          <Reveal><Kicker>How it works</Kicker></Reveal>
          <Reveal delay={80}><h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight max-w-2xl leading-[1.05]">Brief it once. It calls, then reports back.</h2></Reveal>
          <div className="grid md:grid-cols-3 gap-6 mt-14">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} variant="up" delay={i * 90}>
                <div className="step-card">
                  <p className="text-brand font-mono text-sm font-bold">{s.n}</p>
                  <h3 className="font-display text-2xl font-semibold mt-2 mb-2">{s.title}</h3>
                  <p className="text-[#8A7B7E] leading-relaxed">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Live board ── */}
      <section id="board" className="bg-[#FFFAF9] border-y border-[#EADCDF]">
        <div className="max-w-[1200px] mx-auto px-6 py-28">
          <Reveal><Kicker>Live operations</Kicker></Reveal>
          <Reveal delay={80}><h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight max-w-2xl leading-[1.05]">A living board of every call.</h2></Reveal>
          <Reveal delay={140}><p className="text-lg text-[#8A7B7E] mt-5 max-w-xl">Watch calls move from queued to resolved in real time — every outcome recorded and searchable.</p></Reveal>
          <Reveal variant="scale" delay={120} className="mt-12"><LiveBoardMock /></Reveal>
        </div>
      </section>

      {/* ── Transcript demo ── */}
      <section id="demo" className="bg-white">
        <div className="max-w-[1200px] mx-auto px-6 py-28 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Reveal><Kicker>See a call</Kicker></Reveal>
            <Reveal delay={80}><h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">It doesn&apos;t just dial. It handles the conversation.</h2></Reveal>
            <Reveal delay={140}><p className="text-lg text-[#8A7B7E] mt-5 max-w-md">Envoy speaks naturally, answers questions, negotiates a settlement date, and logs a clear outcome — no script-reading robot.</p></Reveal>
          </div>
          <Reveal variant="right" delay={100}><TranscriptDemo /></Reveal>
        </div>
      </section>

      {/* ── Use cases ── */}
      <section id="uses" className="bg-[#FFFAF9] border-y border-[#EADCDF]">
        <div className="max-w-[1200px] mx-auto px-6 py-28">
          <Reveal><Kicker>One agent, many jobs</Kicker></Reveal>
          <Reveal delay={80}><h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight max-w-2xl leading-[1.05]">Any outbound call, handled.</h2></Reveal>
          <div className="grid sm:grid-cols-2 gap-6 mt-14">
            {USES.map((u, i) => (
              <Reveal key={u.title} variant="up" delay={i * 80}>
                <div className="use-card">
                  <span className="inline-flex w-9 h-9 rounded-lg bg-[#5C0F22] text-white items-center justify-center text-sm font-bold">{i + 1}</span>
                  <h3 className="font-display text-xl font-semibold mt-4 mb-1.5">{u.title}</h3>
                  <p className="text-[#8A7B7E] leading-relaxed">{u.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA (dark) ── */}
      <section className="bg-[#5C0F22] text-[#F8EEF0]">
        <div className="max-w-[1200px] mx-auto px-6 py-28 text-center">
          <Reveal><Kicker dark>Ready when you are</Kicker></Reveal>
          <Reveal delay={80}><h2 className="font-display text-4xl md:text-6xl font-semibold tracking-tight leading-[1.02]">Stop chasing. Start collecting.</h2></Reveal>
          <Reveal delay={140}><p className="text-lg text-[#F8EEF0]/70 mt-5 max-w-xl mx-auto">Let Envoy make the calls you keep putting off — and hand you the outcomes.</p></Reveal>
          <Reveal delay={200}>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-9">
              <Link href={SIGNUP} className="landing-cta">Create your company account <span aria-hidden>→</span></Link>
              <Link href={LOGIN} className="landing-cta-ghost">Log in</Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-[#0d0105] text-white/60">
        <div className="max-w-[1200px] mx-auto px-6 py-14 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <IconEnvoy className="w-6 h-6" />
            <span className="font-bold text-white">Envoy</span>
            <span className="text-white/40 text-sm">· AI outbound calling</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span>Powered by</span>
            <a href="https://isoftanz.com.au/" target="_blank" rel="noopener noreferrer"><IsoftLogo className="h-5" white /></a>
          </div>
        </div>
        <div className="border-t border-white/10">
          <p className="max-w-[1200px] mx-auto px-6 py-5 text-xs text-white/40">© 2026 iSOFT · Valuing relationships, delivering outcomes.</p>
        </div>
      </footer>
    </div>
  );
}
