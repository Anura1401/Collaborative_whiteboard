import React from 'react';
import {
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
  Copy,
  Trash2,
} from 'lucide-react';
import { boardStore } from '../store/boardStore.js';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ x, y, onClose }: ContextMenuProps): React.JSX.Element {
  const hasSelection = Boolean(boardStore.selectedId);

  if (!hasSelection) return <></>;

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      className="glass-panel"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 100,
        padding: 4,
        minWidth: 160,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        className="icon-btn"
        style={{ width: '100%', height: 28, justifyContent: 'flex-start', padding: '0 8px', gap: 8, fontSize: 12 }}
        onClick={() => handleAction(() => boardStore.reorderSelection('front'))}
      >
        <ChevronsUp size={14} /> Bring to Front
      </button>
      <button
        className="icon-btn"
        style={{ width: '100%', height: 28, justifyContent: 'flex-start', padding: '0 8px', gap: 8, fontSize: 12 }}
        onClick={() => handleAction(() => boardStore.reorderSelection('forward'))}
      >
        <ChevronUp size={14} /> Bring Forward
      </button>
      <button
        className="icon-btn"
        style={{ width: '100%', height: 28, justifyContent: 'flex-start', padding: '0 8px', gap: 8, fontSize: 12 }}
        onClick={() => handleAction(() => boardStore.reorderSelection('backward'))}
      >
        <ChevronDown size={14} /> Send Backward
      </button>
      <button
        className="icon-btn"
        style={{ width: '100%', height: 28, justifyContent: 'flex-start', padding: '0 8px', gap: 8, fontSize: 12 }}
        onClick={() => handleAction(() => boardStore.reorderSelection('back'))}
      >
        <ChevronsDown size={14} /> Send to Back
      </button>

      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 0' }} />

      <button
        className="icon-btn"
        style={{ width: '100%', height: 28, justifyContent: 'flex-start', padding: '0 8px', gap: 8, fontSize: 12 }}
        onClick={() => handleAction(() => boardStore.duplicateSelection())}
      >
        <Copy size={14} /> Duplicate
      </button>
      <button
        className="icon-btn"
        style={{
          width: '100%',
          height: 28,
          justifyContent: 'flex-start',
          padding: '0 8px',
          gap: 8,
          fontSize: 12,
          color: 'var(--danger)',
        }}
        onClick={() => handleAction(() => boardStore.deleteSelection())}
      >
        <Trash2 size={14} /> Delete
      </button>
    </div>
  );
}
