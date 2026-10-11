import React, { useEffect, useState } from 'react';
import {
  Layers,
  Square,
  Circle,
  Minus,
  PenTool,
  Type,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { boardStore } from '../store/boardStore.js';
import type { Obj, ObjType } from '@whiteboard/shared';

function getObjIcon(type: ObjType) {
  switch (type) {
    case 'rect':
      return Square;
    case 'ellipse':
      return Circle;
    case 'line':
      return Minus;
    case 'stroke':
      return PenTool;
    case 'text':
      return Type;
  }
}

function getObjTitle(obj: Obj): string {
  switch (obj.type) {
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'line':
      return 'Line';
    case 'stroke':
      return 'Freehand Stroke';
    case 'text': {
      const text = String(obj.props.text ?? '');
      return text.trim() ? text.slice(0, 18) : 'Text';
    }
    default:
      return 'Object';
  }
}

export function LayersPanel(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [order, setOrder] = useState<string[]>(boardStore.view.order);
  const [objects, setObjects] = useState<Record<string, Obj>>(boardStore.view.objects);
  const [selectedId, setSelectedId] = useState<string | null>(boardStore.selectedId);

  useEffect(() => {
    return boardStore.subscribe(() => {
      setOrder([...boardStore.view.order]);
      setObjects({ ...boardStore.view.objects });
      setSelectedId(boardStore.selectedId);
    });
  }, []);

  // Layers list is shown front at top (reverse of order array)
  const layerIds = [...order].reverse();

  return (
    <aside
      className="glass-panel"
      style={{
        position: 'fixed',
        top: 72,
        left: 16,
        bottom: 24,
        width: collapsed ? 44 : 220,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 30,
        transition: 'width var(--transition-normal)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={16} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Layers</span>
          </div>
        )}
        <button
          className="icon-btn"
          style={{ width: 24, height: 24, marginLeft: collapsed ? 'auto' : 0 }}
          onClick={() => setCollapsed(!collapsed)}
          data-tooltip={collapsed ? 'Expand Layers' : 'Collapse Layers'}
          aria-label={collapsed ? 'Expand Layers' : 'Collapse Layers'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Layer items */}
      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {layerIds.length === 0 ? (
            <div
              style={{
                padding: '24px 12px',
                textAlign: 'center',
                fontSize: 11,
                color: 'var(--text-muted)',
              }}
            >
              No objects on canvas
            </div>
          ) : (
            layerIds.map((id) => {
              const obj = objects[id];
              if (!obj || obj.deleted) return null;

              const Icon = getObjIcon(obj.type);
              const isSelected = selectedId === id;

              return (
                <div
                  key={id}
                  onClick={() => boardStore.setSelected(id)}
                  onMouseEnter={() => boardStore.setHovered(id)}
                  onMouseLeave={() => boardStore.setHovered(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12,
                    cursor: 'pointer',
                    background: isSelected ? 'var(--accent-light)' : 'transparent',
                    color: isSelected ? 'var(--accent-primary)' : 'var(--text-main)',
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                    <Icon size={14} />
                    <span
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {getObjTitle(obj)}
                    </span>
                  </div>

                  {/* Move up / down controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button
                      className="icon-btn"
                      style={{ width: 20, height: 20 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        boardStore.submit({ type: 'REORDER', objectId: id, action: 'forward' });
                      }}
                      data-tooltip="Move Forward"
                      aria-label="Move Forward"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      className="icon-btn"
                      style={{ width: 20, height: 20 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        boardStore.submit({ type: 'REORDER', objectId: id, action: 'backward' });
                      }}
                      data-tooltip="Move Backward"
                      aria-label="Move Backward"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </aside>
  );
}
