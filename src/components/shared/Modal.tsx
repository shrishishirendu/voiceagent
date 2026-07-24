'use client';

import { type ReactNode } from 'react';

/** Generic centered modal — for anything that isn't detail-inspection (use Drawer for that). */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} bg-white rounded-2xl shadow-2xl animate-fade-in max-h-[85vh] flex flex-col`}>
        {title && (
          <div className="flex-none px-5 py-4 border-b border-slate-100">
            <div className="text-sm font-bold text-slate-900">{title}</div>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
