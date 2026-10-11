import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BoardView } from './routes/BoardView.js';
import { NotFound } from './routes/NotFound.js';
import './styles/index.css';

export function App(): React.JSX.Element {
  const [boardId, setBoardId] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const path = window.location.pathname;

    if (path.startsWith('/b/')) {
      const id = path.slice(3).split('/')[0];
      if (id) {
        setBoardId(id);
        setIsLoading(false);
        return;
      }
    }

    if (path === '/' || path === '') {
      // Auto-create or fetch default board
      const apiUrl = import.meta.env.VITE_API_URL || '';
      fetch(`${apiUrl}/api/boards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled Board' }),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to create board');
          return res.json();
        })
        .then((data: { id: string }) => {
          window.history.replaceState(null, '', `/b/${data.id}`);
          setBoardId(data.id);
          setIsLoading(false);
        })
        .catch(() => {
          // Fallback to random client-side UUID if backend not reachable directly
          const fallbackId = crypto.randomUUID();
          window.history.replaceState(null, '', `/b/${fallbackId}`);
          setBoardId(fallbackId);
          setIsLoading(false);
        });
    } else {
      setIsNotFound(true);
      setIsLoading(false);
    }
  }, []);

  if (isLoading) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-app)',
          color: 'var(--text-muted)',
          fontSize: 14,
        }}
      >
        Loading board...
      </div>
    );
  }

  if (isNotFound || !boardId) {
    return <NotFound />;
  }

  return <BoardView boardId={boardId} />;
}

if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
}
