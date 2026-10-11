import React from 'react';
import { AlertTriangle, Home } from 'lucide-react';

export function NotFound(): React.JSX.Element {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: 'var(--bg-app)',
        color: 'var(--text-main)',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 'var(--radius-full)',
          background: 'var(--danger-light)',
          color: 'var(--danger)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AlertTriangle size={28} />
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Board Not Found</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 360, textAlign: 'center' }}>
        The whiteboard link you requested does not exist or has expired.
      </p>
      <a
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          background: 'var(--accent-primary)',
          color: '#ffffff',
          borderRadius: 'var(--radius-sm)',
          textDecoration: 'none',
          fontSize: 13,
          fontWeight: 500,
          marginTop: 8,
        }}
      >
        <Home size={15} /> Create New Board
      </a>
    </div>
  );
}
