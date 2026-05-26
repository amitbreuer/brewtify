import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  type: 'error' | 'success' | 'info';
}

interface ToastContextType {
  showToast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: Toast['type'] = 'error') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-lg px-4 py-3 text-sm shadow-lg animate-fade-in ${
              toast.type === 'error'
                ? 'bg-red-900/90 text-red-100'
                : toast.type === 'success'
                ? 'bg-green-900/90 text-green-100'
                : 'bg-neutral-800/90 text-neutral-100'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
