import { createContext, useContext, useState, useCallback, useEffect, type ReactNode, type ReactElement } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string, options?: { durationMs?: number; action?: ToastAction }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, options?: { durationMs?: number; action?: ToastAction }) => {
    const { durationMs = AUTO_DISMISS_MS, action } = options ?? {};
    const id = ++nextId;
    setToasts((prev) => {
      if (prev.some((t) => t.message === message)) return prev;
      return [...prev, { id, type, message, action }];
    });
    setTimeout(() => removeToast(id), durationMs);
  }, [removeToast]);

  useEffect(() => {
    const unsub = window.dictator.onErrorNotification((message) => {
      addToast('error', message);
    });
    return unsub;
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

function SuccessIcon() {
  return (
    <svg className="mt-px h-4 w-4 shrink-0 text-ok-text" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="mt-px h-4 w-4 shrink-0 text-accent-strong" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="mt-px h-4 w-4 shrink-0 text-text-dim" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
    </svg>
  );
}

const ICON_MAP: Record<ToastType, () => ReactElement> = {
  success: SuccessIcon,
  error: ErrorIcon,
  info: InfoIcon,
};

interface ToastContainerProps {
  toasts: Toast[];
  removeToast: (id: number) => void;
}

function ToastContainer({ toasts, removeToast }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICON_MAP[toast.type];
        return (
          <div
            key={toast.id}
            role="alert"
            className="flex items-start gap-2.5 rounded-[10px] border border-border bg-surface py-2.5 pl-3.5 pr-2 text-[13px] text-text shadow-widget animate-fade-in"
          >
            <Icon />
            <div className="flex-1 leading-snug">
              <span>{toast.message}</span>
              {toast.action && (
                <button
                  onClick={() => { toast.action?.onClick(); removeToast(toast.id); }}
                  className="ml-2 underline underline-offset-[3px] transition-colors hover:text-text-muted"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss notification"
              className="-my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-border hover:text-text"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
