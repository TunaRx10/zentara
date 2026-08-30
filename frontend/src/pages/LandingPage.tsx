/**
 * Zentara — Public Marketing Landing (`/landing`)
 *
 * Modelled on useolivine.com's marketing structure but adapted to our
 * personal-first Strategic Intelligence value prop:
 *
 *   1. Top nav (logo + anchors + Sign In + "Open Zentara →")
 *   2. Hero (value prop + sub + CTA + trust badges)
 *   3. Live product preview (screenshot mockup of the dashboard)
 *   4. Feature grid ("Everything you need")
 *   5. How it works (3 steps)
 *   6. "Why Zentara" split (vs SaaS)
 *   7. FAQ (accordion)
 *   8. Footer + final CTA
 *
 * Theme: dark KeeLead (black bg, gradient blue→emerald CTA),
 * Hot/Warm/Cold accents in green/amber/red (Olivine-style).
 * NO payment section (Zentara is personal, free).
 * NO website preview (not in scope).
 */
import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  Sparkles,
  Brain,
  Search,
  Shield,
  Database,
  Layers,
  Target,
  Zap,
  Eye,
  Lock,
  Bell,
  Check,
  Play,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/services/auth/auth.context';

// =====================================================================
// Sub-components (Olivine-style)
// =====================================================================

/**
 * Round 138 — BrandMarkSmall : monogramme argenté dans carré noir premium
 * (réplique exacte du favicon, juste sans la micro-bordure).
 */
function BrandMarkSmall(): React.ReactElement {
  return (
    <svg
      role="img"
      aria-label="Zentara"
      width={32}
      height={32}
      viewBox="0 0 512 512"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="lmSilver" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#D6DAE2" />
          <stop offset="100%" stopColor="#7E8693" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="#14141B" />
      <path
        d="M 160 168 H 360 L 160 344 H 360"
        fill="none"
        stroke="url(#lmSilver)"
        strokeWidth="48"
        strokeLinecap="round"
        strokeLinejoin="miter"
        strokeMiterlimit="6"
      />
      <rect x="378" y="378" width="34" height="34" rx="6" fill="#E8ECF2" fillOpacity="0.92" />
    </svg>
  );
}

/**
 * Pillule de confiance (Hot/Warm/Cold/etc.) — partagée par la table et
 * la hero.
 */
function Pill({
  children,
  variant = 'neutral',
}: {
  children: React.ReactNode;
  variant?: 'hot' | 'warm' | 'cold' | 'neutral' | 'primary';
}): React.ReactElement {
  const styles =
    variant === 'hot'
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      : variant === 'warm'
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
        : variant === 'cold'
          ? 'bg-white/5 text-zinc-400 border-white/10'
          : variant === 'primary'
            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
            : 'bg-white/5 text-zinc-300 border-white/10';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
        'text-[11px] font-bold tracking-wide',
        styles,
      )}
    >
      {children}
    </span>
  );
}

/**
 * CTA principal (charcoal pill comme Olivine). Variantes: primary (dark),
 * ghost (outline), quiet (text).
 */
function CTA({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  href,
  to,
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'ghost' | 'quiet';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  href?: string;
  /** Route interne react-router (rends <Link> au lieu de <a>). */
  to?: string;
}): React.ReactElement {
  const klass = cn(
    'inline-flex items-center justify-center gap-2 rounded-full font-bold tracking-tight transition-all',
    size === 'lg' ? 'h-12 px-6 text-base' : size === 'sm' ? 'h-9 px-4 text-xs' : 'h-11 px-5 text-sm',
    variant === 'primary'
      ? 'bg-gradient-to-r from-lime-500 to-lime-400 text-black hover:from-lime-600 hover:to-lime-500 shadow-lg glow-lime'
      : variant === 'ghost'
        ? 'bg-white/5 text-white border border-white/20 hover:border-white/40 hover:bg-white/10'
        : 'bg-transparent text-zinc-300 hover:bg-white/5',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black',
  );
  // 1. Internal Link react-router (priorité sur href/onClick).
  if (to !== undefined) {
    return (
      <Link to={to} className={klass}>
        {children}
      </Link>
    );
  }
  // 2. External anchor.
  if (href !== undefined) {
    return (
      <a href={href} onClick={onClick} className={klass}>
        {children}
      </a>
    );
  }
  // 3. Plain button (fallback).
  return (
    <button type="button" onClick={onClick} className={klass}>
      {children}
    </button>
  );
}

// =====================================================================
// Sections
// =====================================================================

function TopNav(): React.ReactElement {
  return (
    <header className="sticky top-0 z-40 w-full bg-black/80 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2 group">
          <BrandMarkSmall />
          <span className="text-lg font-black tracking-tight text-white">Zentara</span>
        </a>
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#how" className="hover:text-white transition-colors">How it works</a>
          <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="hidden sm:inline-flex h-9 px-3 text-sm font-bold text-zinc-400 hover:text-white items-center"
          >
            Sign In
          </Link>
          <CTA size="sm" to="/">
            Open Zentara <ArrowRight size={14} />
          </CTA>
        </div>
      </div>
    </header>
  );
}

function Hero(): React.ReactElement {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* Background grid + soft glow */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 0%, rgba(59,130,246,0.14) 0%, transparent 60%), radial-gradient(circle at 80% 10%, rgba(16,185,129,0.08) 0%, transparent 45%)',
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse at top, black 30%, transparent 70%)',
        }}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-12 sm:pb-20 text-center relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 backdrop-blur px-3 py-1 mb-6 shadow-sm">
          <Sparkles size={12} className="text-blue-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
            Personal Strategic Intelligence · Offline-first
          </span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white leading-[1.05]">
          Find strategic intelligence
          <br />
          <span className="gradient-text">
            before your competitors do.
          </span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          Search local businesses and prospects, generate AI-powered analyses, and turn signals
          into action — all in one private workflow, on your machine.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <CTA size="lg" to="/">
            Start for free <ArrowRight size={16} />
          </CTA>
          <CTA size="lg" variant="ghost" href="#how">
            <Play size={14} className="text-blue-400" />
            See how it works
          </CTA>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          No credit card. No account creation. Your data never leaves your device.
        </p>

        {/* Trust badges (Olivine-style small chips) */}
        <div className="mt-10 flex flex-wrap justify-center items-center gap-3">
          <Pill variant="neutral">
            <Check size={11} className="text-emerald-600" /> 7 specialised AI engines
          </Pill>
          <Pill variant="neutral">
            <Check size={11} className="text-emerald-600" /> 50+ prospecting categories
          </Pill>
          <Pill variant="neutral">
            <Check size={11} className="text-emerald-600" /> Built for solo operators
          </Pill>
        </div>

        {/* Hero product preview (mockup card) */}
        <div className="mt-14 sm:mt-20 relative">
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

/**
 * Mockup "Lead Finder" table — réplique visuelle de l'app Zentara en
 * format screenshot. Ne s'affiche qu'en marketing, jamais en vrai.
 */
function HeroPreview(): React.ReactElement {
  const rows = [
    { name: 'Lakeview Dental Group', location: 'Paris', score: 87, tag: 'hot' as const, signal: 'No website' },
    { name: 'Sunrise Family Dentistry', location: 'Lyon', score: 74, tag: 'hot' as const, signal: 'Outdated site' },
    { name: 'Cedar & Pine Cabinetry', location: 'Bordeaux', score: 62, tag: 'warm' as const, signal: 'Old SEO' },
    { name: 'Verde Wellness Studio', location: 'Nice', score: 48, tag: 'warm' as const, signal: 'No reviews' },
    { name: 'Northside Auto Group', location: 'Lille', score: 28, tag: 'cold' as const, signal: 'Strong brand' },
    { name: 'Marble & Co. Interiors', location: 'Marseille', score: 21, tag: 'cold' as const, signal: 'Active blog' },
  ];
  return (
    <div className="absolute -top-4 sm:-top-6 left-1/2 -translate-x-1/2 w-full pointer-events-none">
      <div
        className={cn(
          'mx-auto max-w-4xl rounded-2xl overflow-hidden',
          'border border-white/10 bg-[#0a0a0a] shadow-2xl shadow-black/30',
        )}
      >
        {/* Tabs bar (Lead Finder / Pipeline / Intelligence) */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 h-10 bg-black">
          <div className="flex items-center gap-1">
            {['Lead Finder', 'Pipeline', 'Intelligence'].map((t, i) => (
              <div
                key={t}
                className={cn(
                  'h-7 px-3 inline-flex items-center text-[11px] font-bold rounded-md',
                  i === 0 ? 'bg-[#0a0a0a] text-white' : 'text-zinc-400',
                )}
              >
                {t}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 px-2 rounded-md border border-white/10 bg-white/5 text-[10px] text-zinc-500 inline-flex items-center">
              Search…
            </div>
            <div className="h-6 w-6 rounded-md bg-[#0a0a0a] text-white text-[10px] inline-flex items-center justify-center font-bold">
              +
            </div>
          </div>
        </div>
        {/* Table */}
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
            <tr>
              <th className="px-4 py-3 font-bold">Business</th>
              <th className="px-4 py-3 font-bold hidden sm:table-cell">Location</th>
              <th className="px-4 py-3 font-bold hidden md:table-cell">Signal</th>
              <th className="px-4 py-3 font-bold">Score</th>
              <th className="px-4 py-3 font-bold">Tier</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-white/10">
                <td className="px-4 py-3 font-bold text-white">{r.name}</td>
                <td className="px-4 py-3 text-zinc-400 hidden sm:table-cell">{r.location}</td>
                <td className="px-4 py-3 text-zinc-400 hidden md:table-cell">{r.signal}</td>
                <td className="px-4 py-3 font-bold text-white">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        r.tag === 'hot' ? 'bg-emerald-500' : r.tag === 'warm' ? 'bg-amber-500' : 'bg-zinc-600',
                      )}
                    />
                    {r.score}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Pill variant={r.tag}>
                    {r.tag === 'hot' ? 'Hot' : r.tag === 'warm' ? 'Warm' : 'Cold'}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Features(): React.ReactElement {
  const features: Array<{
    icon: React.ReactNode;
    title: string;
    body: string;
    hint: string;
  }> = [
    {
      icon: <Search size={20} />,
      title: 'Lead Finder',
      body: 'Search across 50+ categories with intelligent scoring and live website signals.',
      hint: 'Hot/Warm/Cold triage',
    },
    {
      icon: <Layers size={20} />,
      title: 'Pipeline',
      body: 'Drag prospects across Discovery → Contacted → Qualified → Won. Never lose a deal.',
      hint: 'Kanban-style stages',
    },
    {
      icon: <Brain size={20} />,
      title: '7 AI Engines',
      body: 'Research, intelligence analysis, prospect & company scoring, opportunity detection — chainable.',
      hint: 'Provider-agnostic',
    },
    {
      icon: <Database size={20} />,
      title: 'Knowledge (RAG)',
      body: 'Ingest your own docs (PDF, MD, web). The AI retrieves from your private knowledge base.',
      hint: 'Local-first embeddings',
    },
    {
      icon: <Eye size={20} />,
      title: 'Monitoring',
      body: 'Detect signals, hiring posts, and signals of intent. Track changes that matter.',
      hint: 'Background watchers',
    },
    {
      icon: <BarChart3 size={20} />,
      title: 'Analytics',
      body: 'Understand your funnel: conversion rates, hot ratios, time-to-close, AI usage.',
      hint: 'KPI dashboards',
    },
  ];
  return (
    <section id="features" className="py-20 sm:py-28 bg-[#0a0a0a]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto">
          <Pill variant="primary">
            <Sparkles size={11} /> Everything you need
          </Pill>
          <h2 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-white">
            From raw signal to strategic action.
          </h2>
          <p className="mt-4 text-zinc-400 text-lg">
            Zentara is a complete prospecting workspace that turns your private knowledge into concrete
            next steps.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <div
              key={f.title}
              className={cn(
                'rounded-2xl border border-white/10 bg-[#0a0a0a] p-6',
                'transition-all hover:border-white/20 hover:shadow-lg hover:shadow-black/30',
              )}
            >
              <div className="h-10 w-10 rounded-xl bg-[#0a0a0a] text-white flex items-center justify-center mb-4">
                {f.icon}
              </div>
              <h3 className="text-lg font-black text-white">{f.title}</h3>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{f.body}</p>
              <div className="mt-4 text-[11px] uppercase tracking-widest font-bold text-zinc-500">
                {f.hint}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks(): React.ReactElement {
  const steps = [
    {
      n: '01',
      icon: <Search size={20} />,
      title: 'Capture raw signals',
      body: 'Pull businesses from local directories, Google Maps, your own notes, or paste a list. Zentara scores each one with opportunity signals.',
    },
    {
      n: '02',
      icon: <Brain size={20} />,
      title: 'Run the 7 AI engines',
      body: 'Research, intelligence analysis, scoring, opportunity detection — chainable and provider-agnostic. Output stored locally.',
    },
    {
      n: '03',
      icon: <Target size={20} />,
      title: 'Act on the synthesis',
      body: 'A strategic synthesis gives you clear next steps, ranked by priority and confidence. Move prospects through your pipeline.',
    },
  ];
  return (
    <section id="how" className="py-20 sm:py-28 bg-black border-y border-white/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto">
          <Pill variant="primary">
            <Zap size={11} /> How it works
          </Pill>
          <h2 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-white">
            Three steps from search to decision.
          </h2>
          <p className="mt-4 text-zinc-400 text-lg">
            Designed for solo operators. No team plan, no admin panel, no telemetry.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-5">
          {steps.map((s) => (
            <div
              key={s.n}
              className={cn(
                'relative rounded-2xl border border-white/10 bg-[#0a0a0a] p-6',
                'overflow-hidden',
              )}
            >
              <div className="absolute -top-2 -right-2 text-[88px] font-black text-zinc-200 leading-none select-none pointer-events-none">
                {s.n}
              </div>
              <div className="relative">
                <div className="h-10 w-10 rounded-xl bg-[#0a0a0a] text-white flex items-center justify-center mb-4">
                  {s.icon}
                </div>
                <h3 className="text-lg font-black text-white">{s.title}</h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhySplit(): React.ReactElement {
  const items = [
    { icon: <Lock size={16} />, label: 'Private by default — local DB, no friction' },
    { icon: <Database size={16} />, label: 'Offline-first — works without backend' },
    { icon: <Shield size={16} />, label: 'Your API keys never leave the server' },
    { icon: <Brain size={16} />, label: '7 specialized engines — not a generic chat' },
    { icon: <Layers size={16} />, label: 'Bring your own provider (OpenAI, Gemini, DeepSeek)' },
    { icon: <Target size={16} />, label: 'No telemetry, no team plan, no paywall' },
  ];
  return (
    <section className="py-20 sm:py-28 bg-[#0a0a0a]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <Pill variant="primary">
            <Shield size={11} /> Why Zentara
          </Pill>
          <h2 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight">
            A strategic workspace.
            <br />
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Not a SaaS dashboard.
            </span>
          </h2>
          <p className="mt-5 text-zinc-400 text-lg leading-relaxed">
            Most tools are built for teams. Zentara is built for one. Your prospects, your analysis,
            your pipeline — all on your machine, with a single cloud hop when you want AI.
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((i) => (
              <div key={i.label} className="flex items-start gap-2.5 text-sm text-zinc-300">
                <span className="mt-0.5 h-5 w-5 rounded-md bg-[#0a0a0a] text-white flex items-center justify-center shrink-0">
                  {i.icon}
                </span>
                <span className="font-medium">{i.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Visual: dark-isolated sandbox teaser */}
        <div
          className={cn(
            'relative rounded-2xl overflow-hidden',
            'border border-white/20 bg-[#0a0a0a] text-white',
            'shadow-2xl shadow-black/40',
          )}
        >
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                'radial-gradient(circle at 80% 20%, rgba(99,102,241,0.4) 0%, transparent 60%)',
            }}
          />
          <div className="relative p-6 sm:p-8">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest font-bold text-emerald-300">
                  Backend · online
                </span>
              </div>
              <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-500">
                Sandbox
              </span>
            </div>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                  Intent signal · detected 2h
                </div>
                <div className="font-bold">Lakeview Dental Group just hired a Head of Marketing.</div>
              </div>
              <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">
                  AI Synthesis
                </div>
                <div className="text-zinc-300">
                  High opportunity. Pitch a one-pager for a marketing site revamp within 7 days.
                </div>
              </div>
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3">
                <div className="text-[10px] uppercase tracking-widest text-emerald-300 mb-1">
                  Recommended action
                </div>
                <div className="font-bold text-emerald-200">
                  CRITICAL · 96% confidence · Send outreach today.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ(): React.ReactElement {
  const items: Array<{ q: string; a: string }> = [
    {
      q: 'Is Zentara free?',
      a: 'Zentara itself is free and open-source-style. You only pay for the AI provider you choose (OpenAI, Gemini, DeepSeek, or local). Your data lives only on your machine by default.',
    },
    {
      q: 'Do I need a backend?',
      a: 'No. Zentara works fully offline with local SQLite for your data. The backend (a thin Express service) is needed only when you call external AI providers — and even then it can run on your laptop.',
    },
    {
      q: 'What are the 7 AI engines?',
      a: 'Research, Intelligence Analysis, Prospect Intelligence, Company Intelligence, Opportunity Detection, Scoring, and Strategic Synthesis. Each is a specialized prompt that runs on your chosen provider.',
    },
    {
      q: 'Can I use my own documents?',
      a: 'Yes. Zentara includes a Knowledge module that ingests PDFs, Markdown, and web pages into a local vector store. The AI retrieves from your private knowledge before answering.',
    },
    {
      q: 'How is my data protected?',
      a: 'Local SQLite, accès direct sans verrou. API keys are stored server-side only — never in the app code.',
    },
    {
      q: 'Can I export my data?',
      a: 'Yes. Full backup/restore in JSON or CSV. Import validated against schema. You own your data.',
    },
  ];
  const [open, setOpen] = React.useState<number | null>(0);
  return (
    <section id="faq" className="py-20 sm:py-28 bg-black border-t border-white/10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <Pill variant="primary">
            <Bell size={11} /> Common questions
          </Pill>
          <h2 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-white">
            Frequently asked.
          </h2>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden">
          {items.map((it, i) => {
            const isOpen = open === i;
            const panelId = `faq-panel-${i}`;
            return (
              <div key={it.q} className={cn('border-b border-white/10 last:border-b-0')}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={cn(
                    'w-full flex items-center justify-between gap-4 px-5 py-4 text-left',
                    'transition-colors hover:bg-black',
                  )}
                >
                  <span className="text-base font-bold text-white">{it.q}</span>
                  <ChevronDown
                    size={18}
                    className={cn(
                      'text-zinc-500 transition-transform duration-300 shrink-0',
                      isOpen && 'rotate-180 text-white',
                    )}
                  />
                </button>
                {isOpen && (
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={`faq-button-${i}`}
                    className="px-5 pb-5 -mt-2 text-sm text-zinc-400 leading-relaxed animate-in fade-in slide-in-from-top-2 duration-300"
                  >
                    {it.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Footer(): React.ReactElement {
  return (
    <footer className="bg-[#0a0a0a] text-zinc-400 pt-16 pb-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 pb-10 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <Sparkles size={16} className="text-white" />
              </div>
              <span className="text-xl font-black tracking-tight text-white">Zentara</span>
            </div>
            <p className="text-sm text-zinc-500 leading-relaxed max-w-sm">
              Personal Strategic Intelligence. Your data, your AI, your machine.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-zinc-500 mb-3">
                Product
              </div>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#how" className="hover:text-white transition-colors">How it works</a></li>
                <li><a href="#faq" className="hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-zinc-500 mb-3">
                Get started
              </div>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link to="/" className="hover:text-white transition-colors">
                    Open app →
                  </Link>
                </li>
                <li>
                  <a href="#top" className="hover:text-white transition-colors">Back to top</a>
                </li>
              </ul>
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest font-bold text-zinc-500 mb-3">
              Built for solo operators
            </div>
            <p className="text-sm text-zinc-500 mb-4">
              No team plan. No paywall. No telemetry. Just a sharp tool in your pocket.
            </p>
            <CTA size="sm" to="/">
              Open Zentara <ArrowRight size={14} />
            </CTA>
          </div>
        </div>
        <div className="pt-6 flex items-center justify-between text-xs text-zinc-500">
          <div>© Zentara · Personal Strategic Intelligence</div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Local-first by design
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// =====================================================================
// Page
// =====================================================================

export function LandingPage(): React.ReactElement {
  const { state } = useAuth();
  const isAuthed = state.kind === 'authenticated';
  return (
    <div className="min-h-screen bg-black text-white font-sans antialiased">
      {/* Banner discret si pas authentifié : CTA "Open app" en haut */}
      {!isAuthed && (
        <div className="bg-[#0a0a0a] text-white text-center text-xs py-2 px-4 flex items-center justify-center gap-2">
          <span className="opacity-75">Browsing the public pitch.</span>
          <span aria-hidden>·</span>
          <Link
            to="/"
            className="font-bold underline underline-offset-2 hover:text-emerald-300 transition-colors"
          >
            Sign in to open the app →
          </Link>
        </div>
      )}
      <TopNav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <WhySplit />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}
