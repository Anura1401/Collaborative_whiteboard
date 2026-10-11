import React, { useEffect, useState } from 'react';
import {
  Undo2,
  Redo2,
  Share2,
  Sun,
  Moon,
  ZoomIn,
  ZoomOut,
  Info,
} from 'lucide-react';

import { boardStore } from '../store/boardStore.js';
import type { Camera } from '../canvas/camera.js';
import { ShortcutCheatsheet } from './ShortcutCheatsheet.js';

interface TopBarProps {
  boardName: string;
  onBoardNameChange: (name: string) => void;
  camera: Camera;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export function TopBar({
  boardName,
  onBoardNameChange,
  camera,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: TopBarProps): React.JSX.Element {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(boardName);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [canUndo, setCanUndo] = useState(boardStore.canUndo());
  const [canRedo, setCanRedo] = useState(boardStore.canRedo());
  const [presenceUsers, setPresenceUsers] = useState(boardStore.presenceUsers);
  const [status, setStatus] = useState(boardStore.status);
  const [showCheatsheet, setShowCheatsheet] = useState(false);

  useEffect(() => {
    return boardStore.subscribe(() => {
      setCanUndo(boardStore.canUndo());
      setCanRedo(boardStore.canRedo());
      setPresenceUsers([...boardStore.presenceUsers]);
      setStatus(boardStore.status);
    });
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    boardStore.dirty = true;
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      boardStore.addToast('Board link copied to clipboard!', 'success');
    } catch {
      boardStore.addToast('Failed to copy link', 'error');
    }
  };

  const handleNameSubmit = () => {
    setIsEditingName(false);
    if (nameVal.trim()) {
      onBoardNameChange(nameVal.trim());
    } else {
      setNameVal(boardName);
    }
  };

  const zoomPercent = Math.round(camera.zoom * 100);

  return (
    <header
      className="glass-panel"
      style={{
        position: 'fixed',
        top: 12,
        left: 16,
        right: 16,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        zIndex: 40,
      }}
    >
      {/* Left: Board Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isEditingName ? (
          <input
            type="text"
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameSubmit();
              if (e.key === 'Escape') {
                setNameVal(boardName);
                setIsEditingName(false);
              }
            }}
            autoFocus
            style={{
              fontWeight: 600,
              fontSize: 14,
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--accent-primary)',
              background: 'transparent',
            }}
          />
        ) : (
          <span
            onClick={() => setIsEditingName(true)}
            style={{
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: 'var(--radius-sm)',
            }}
            title="Click to rename"
          >
            {boardName}
          </span>
        )}

        <div style={{ width: 1, height: 20, background: 'var(--border-subtle)' }} />

        {/* Undo / Redo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            className="icon-btn"
            disabled={!canUndo}
            onClick={() => boardStore.undo()}
            data-tooltip="Undo (Ctrl+Z)"
            aria-label="Undo (Ctrl+Z)"
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon-btn"
            disabled={!canRedo}
            onClick={() => boardStore.redo()}
            data-tooltip="Redo (Ctrl+Shift+Z)"
            aria-label="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={16} />
          </button>
        </div>
      </div>

      {/* Right Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Zoom Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            background: 'var(--bg-panel-hover)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 4px',
          }}
        >
          <button
            className="icon-btn"
            style={{ width: 24, height: 24 }}
            onClick={onZoomOut}
            data-tooltip="Zoom Out (-)"
            aria-label="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <span
            onClick={onResetZoom}
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: '0 4px',
              cursor: 'pointer',
              minWidth: 42,
              textAlign: 'center',
            }}
            data-tooltip="Reset Zoom (Shift+0)"
          >
            {zoomPercent}%
          </span>
          <button
            className="icon-btn"
            style={{ width: 24, height: 24 }}
            onClick={onZoomIn}
            data-tooltip="Zoom In (+)"
            aria-label="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
        </div>

        <div style={{ width: 1, height: 20, background: 'var(--border-subtle)' }} />

        {/* Presence Avatars */}
        {presenceUsers.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 4 }}>
              {presenceUsers.slice(0, 5).map((user, idx) => {
                const isMe = user.clientId === boardStore.myClientId;
                const initial = (user.name || 'U').charAt(0).toUpperCase();
                return (
                  <div
                    key={`${user.clientId}-${idx}`}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: user.color,
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      border: '2px solid var(--bg-panel)',
                      marginLeft: idx === 0 ? 0 : -8,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                      cursor: 'default',
                      userSelect: 'none',
                    }}
                    data-tooltip={`${user.name}${isMe ? ' (You)' : ''}`}
                    title={`${user.name}${isMe ? ' (You)' : ''}`}
                  >
                    {initial}
                  </div>
                );
              })}
              {presenceUsers.length > 5 && (
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'var(--bg-panel-hover)',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    border: '2px solid var(--bg-panel)',
                    marginLeft: -8,
                  }}
                  data-tooltip={`+${presenceUsers.length - 5} more collaborators`}
                  title={`+${presenceUsers.length - 5} more`}
                >
                  +{presenceUsers.length - 5}
                </div>
              )}
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 500,
                color: status === 'LIVE' ? 'var(--text-secondary)' : 'var(--danger)',
                background: 'var(--bg-panel-hover)',
                padding: '3px 8px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: status === 'LIVE' ? '#22c55e' : status === 'DISCONNECTED' ? '#ef4444' : '#eab308',
                  display: 'inline-block',
                }}
              />
              {status === 'LIVE' ? `${presenceUsers.length} online` : status === 'SYNCING' ? 'Syncing...' : 'Offline'}
            </div>
          </div>
        )}

        {/* Keyboard Shortcuts Info Button */}
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setShowCheatsheet(true)}
          onMouseLeave={() => setShowCheatsheet(false)}
        >
          <button
            className={`icon-btn ${showCheatsheet ? 'active' : ''}`}
            onClick={() => setShowCheatsheet((prev) => !prev)}
            data-tooltip="Keyboard Shortcuts"
            aria-label="Keyboard Shortcuts"
          >
            <Info size={16} />
          </button>

          {showCheatsheet && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                zIndex: 1000,
                animation: 'fadeIn 120ms ease-out',
              }}
            >
              <ShortcutCheatsheet />
            </div>
          )}
        </div>

        {/* Theme Toggle */}
        <button
          className="icon-btn"
          onClick={toggleTheme}
          data-tooltip={`Theme: ${theme === 'light' ? 'Dark' : 'Light'}`}
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        {/* Share Button */}
        <button
          onClick={handleShare}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 500,
            color: '#ffffff',
            background: 'var(--accent-primary)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-sm)',
          }}
          data-tooltip="Share Link"
        >
          <Share2 size={14} />
          Share
        </button>
      </div>
    </header>
  );
}
