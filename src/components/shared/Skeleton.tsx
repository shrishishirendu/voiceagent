'use client';

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton-shimmer rounded-md ${className}`} />;
}

/** Generic drop-in for a full-panel view (Settings) while its initial data loads. */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex-1 p-6 space-y-6 overflow-hidden">
      <div className="space-y-2">
        <Bar className="h-5 w-40" />
        <Bar className="h-3 w-64" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-slate-100 p-4 space-y-3" style={{ animationDelay: `${i * 60}ms` }}>
            <Bar className="h-3 w-1/3" />
            <Bar className="h-3 w-full" />
            <Bar className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-100 overflow-hidden">
      <div className="h-[3px] w-full bg-slate-100" />
      <div className="px-4 py-3.5">
        <Bar className="h-2.5 w-20 mb-3" />
        <Bar className="h-7 w-14 mb-2" />
        <Bar className="h-2.5 w-16" />
      </div>
    </div>
  );
}

export function CallRowSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className="w-full bg-white rounded-2xl border border-slate-100 overflow-hidden" style={{ animationDelay: `${delay}ms` }}>
      <div className="px-4 pt-3.5 pb-2.5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <Bar className="h-3.5 w-2/3" />
          <Bar className="h-4 w-16 flex-none rounded-full" />
        </div>
        <div className="flex items-center gap-1.5">
          <Bar className="h-2.5 w-24" />
          <Bar className="h-2.5 w-14" />
        </div>
      </div>
      <div className="px-4 pb-3.5">
        <Bar className="h-2.5 w-32" />
      </div>
    </div>
  );
}

export function InvoiceRowSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className="w-full bg-white rounded-2xl border border-slate-100 overflow-hidden" style={{ animationDelay: `${delay}ms` }}>
      <div className="px-4 pt-3.5 pb-2.5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <Bar className="h-3.5 w-1/2" />
          <Bar className="h-4 w-14 flex-none rounded-full" />
        </div>
        <Bar className="h-2.5 w-1/3" />
      </div>
      <div className="px-4 pb-3.5 flex items-center justify-between">
        <Bar className="h-2.5 w-20" />
        <Bar className="h-2.5 w-16" />
      </div>
    </div>
  );
}

export function CallListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <CallRowSkeleton key={i} delay={i * 60} />
      ))}
    </div>
  );
}

export function InvoiceListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <InvoiceRowSkeleton key={i} delay={i * 60} />
      ))}
    </div>
  );
}
