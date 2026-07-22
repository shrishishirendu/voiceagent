'use client';

type IconProps = { className?: string };

export function IconChart({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3v13.5a.5.5 0 0 0 .5.5H17" strokeLinecap="round" />
      <rect x="6" y="9" width="2.5" height="5" rx="0.5" />
      <rect x="10.5" y="6" width="2.5" height="8" rx="0.5" />
      <rect x="15" y="11" width="2.5" height="3" rx="0.5" />
    </svg>
  );
}

export function IconGrid({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
      <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
      <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
    </svg>
  );
}

export function IconUsers({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7.5" cy="7" r="2.75" />
      <path d="M3 16c0-2.5 2-4.25 4.5-4.25S12 13.5 12 16" strokeLinecap="round" />
      <path d="M13 4.6a2.75 2.75 0 0 1 0 5.3M14.5 15.7c0-2.2-1.2-3.7-3-4.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconCalendar({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8h14" strokeLinecap="round" />
      <path d="M6.5 2.5v3M13.5 2.5v3" strokeLinecap="round" />
    </svg>
  );
}

export function IconGear({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17M5.05 5.05l1.06 1.06M13.89 13.89l1.06 1.06M5.05 14.95l1.06-1.06M13.89 6.11l1.06-1.06" strokeLinecap="round" />
    </svg>
  );
}

export function IconPhone({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 3.5A1.5 1.5 0 015.5 2h1.379a1 1 0 01.958.713l1 3a1 1 0 01-.23 1.02L7.5 7.84a9.077 9.077 0 004.66 4.66l1.107-1.107a1 1 0 011.02-.23l3 1a1 1 0 01.713.958V14.5A1.5 1.5 0 0116.5 16C9.044 16 3 9.956 3 3.5z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrend({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 14l4-4 3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 6.5h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconWallet({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="5" width="14" height="11" rx="2" />
      <path d="M3 8h14" strokeLinecap="round" />
      <circle cx="13.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconX({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    </svg>
  );
}

export function IconCheck({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 10l5 5 7-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconRefresh({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 16v-5h-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 9A7 7 0 0115.5 6.5M15.5 11a7 7 0 01-11 3.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconPlus({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
    </svg>
  );
}

export function IconTrash({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5h14M8 5V3h4v2M6 5l1 12h6l1-12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconEdit({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13.5 3.5a2.121 2.121 0 013 3L6 17H3v-3L13.5 3.5z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChevronDown({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChevronRight({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconArrowLeft({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M15 10H5M5 10l4-4M5 10l4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconInfo({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v5M10 7v.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconSearch({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="9" r="6" />
      <path d="M17 17l-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconPlay({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M6.5 5.5a1 1 0 011.5-.87l7 4a1 1 0 010 1.74l-7 4A1 1 0 016.5 13.5v-8z" />
    </svg>
  );
}

export function IconUpload({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10 13V3M10 3l-4 4M10 3l4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 13v2a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconMic({ className = 'w-4 h-4' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="7.25" y="2.5" width="5.5" height="9.5" rx="2.75" />
      <path d="M4.5 9.5a5.5 5.5 0 0011 0" strokeLinecap="round" />
      <path d="M10 15v2.5M7.5 17.5h5" strokeLinecap="round" />
    </svg>
  );
}

/** Brand mark — comet-trail + sparkle, matching EnvoyIn's IconEnvoyIn but relabeled for Envoy. */
export function IconEnvoy({ className = 'w-5 h-5' }: IconProps) {
  return (
    <svg className={`logo-mark ${className}`} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="envoy-mark-bg" x1="1" y1="1" x2="23" y2="23" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF6B6B" />
          <stop offset="55%" stopColor="#E31E24" />
          <stop offset="100%" stopColor="#7A0C10" />
        </linearGradient>
        <linearGradient id="envoy-mark-trail" x1="3.5" y1="19" x2="12.5" y2="9.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill="url(#envoy-mark-bg)" />
      <path className="logo-trail" d="M4.2 18.3c2.6-3.2 4.2-5.7 5.5-8.5" stroke="url(#envoy-mark-trail)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <circle className="logo-dot" cx="6.6" cy="15.6" r="1" fill="#fff" fillOpacity="0.8" />
      <path className="logo-sparkle" d="M14.3 4.6l1.12 3.12 3.12 1.12-3.12 1.12-1.12 3.12-1.12-3.12-3.12-1.12 3.12-1.12z" fill="#fff" />
    </svg>
  );
}
