'use client';

import { useEffect, type ReactNode } from 'react';
import { IconX } from './Icons';

/** Right-side slide-in panel — backs the call/invoice Detail view and the bulk/queue edit overlays. */
export function Drawer({
  open,
  onClose,
  title,
  width = 'max-w-xl',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  width?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} h-full bg-white shadow-2xl flex flex-col animate-slide-in-right`}>
        {title && (
          <div className="flex-none flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="text-sm font-bold text-slate-900">{title}</div>
            <button onClick={onClose} className="btn-ghost !p-1.5 rounded-lg">
              <IconX className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
