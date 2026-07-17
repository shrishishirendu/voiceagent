'use client';

import { useEffect, useState, useCallback, createContext, useContext, type ReactNode } from 'react';
import { IconCheck, IconX, IconInfo } from './Icons';

export type ToastType = 'success' | 'error' | 'info';
export type ToastItem = { id: number; message: string; type: ToastType; duration?: number };

function ToastStack({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastRow({ toast, dismiss }: { toast: ToastItem; dismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.duration || 3500);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dismiss]);

  const styles: Record<ToastType, string> = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-slate-50 border-slate-200 text-slate-800',
  };
  const icons: Record<ToastType, ReactNode> = {
    success: <IconCheck className="w-4 h-4 text-emerald-500 shrink-0" />,
    error: <IconX className="w-4 h-4 text-red-500 shrink-0" />,
    info: <IconInfo className="w-4 h-4 text-slate-400 shrink-0" />,
  };

  return (
    <div className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium animate-toast-in max-w-sm ${styles[toast.type] || styles.info}`}>
      {icons[toast.type] || icons.info}
      <span className="flex-1">{toast.message}</span>
      <button onClick={() => dismiss(toast.id)} className="ml-1 opacity-50 hover:opacity-100 transition-opacity">
        <IconX className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

let _id = 0;

function useToastState() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration?: number) => {
    const id = ++_id;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismiss };
}

type AddToast = (message: string, type?: ToastType, duration?: number) => void;
const ToastContext = createContext<AddToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, addToast, dismiss } = useToastState();
  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <ToastStack toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useAddToast(): AddToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useAddToast must be used within a ToastProvider');
  return ctx;
}
