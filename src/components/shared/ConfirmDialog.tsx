'use client';

// In-app replacement for window.confirm() — browser confirm dialogs are jarring, block on
// native OS/browser chrome rather than the app's own visual language, and can't be styled
// to distinguish a destructive action (cancel invoice, clear queue) from a routine one.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 animate-fade-in">
        <p className="text-sm font-bold text-slate-900 mb-1.5">{title}</p>
        {message && <p className="text-sm text-slate-500 mb-5 leading-relaxed">{message}</p>}
        <div className={`flex justify-end gap-2 ${message ? '' : 'mt-4'}`}>
          <button className="btn-secondary text-xs py-1.5" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`text-xs py-1.5 px-3.5 rounded-xl font-medium text-white transition-colors ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-brand hover:bg-brand-dark'
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
