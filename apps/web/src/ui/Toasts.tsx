import React, { useEffect, useState } from 'react';
import { boardStore, type ToastMessage } from '../store/boardStore.js';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

export function Toasts(): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastMessage[]>(boardStore.toasts);

  useEffect(() => {
    return boardStore.subscribe(() => {
      setToasts([...boardStore.toasts]);
    });
  }, []);

  if (toasts.length === 0) return <></>;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 84,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 200,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => {
        const isError = t.type === 'error';
        const isSuccess = t.type === 'success';

        return (
          <div
            key={t.id}
            className="glass-panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 500,
              color: isError ? 'var(--danger)' : isSuccess ? 'var(--success)' : 'var(--text-main)',
              borderLeft: `3px solid ${
                isError ? 'var(--danger)' : isSuccess ? 'var(--success)' : 'var(--accent-primary)'
              }`,
              boxShadow: 'var(--shadow-lg)',
              animation: 'fadeIn 120ms ease-out',
            }}
          >
            {isError && <AlertCircle size={15} />}
            {isSuccess && <CheckCircle2 size={15} />}
            {!isError && !isSuccess && <Info size={15} />}
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
