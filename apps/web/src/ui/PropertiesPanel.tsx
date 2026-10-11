import React, { useEffect, useState } from 'react';
import {
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
  Copy,
  Trash2,
} from 'lucide-react';
import { boardStore } from '../store/boardStore.js';
import type { Obj } from '@whiteboard/shared';

const COLOR_SWATCHES = [
  '#000000',
  '#1e1e1e',
  '#e02424',
  '#e05206',
  '#d97706',
  '#059669',
  '#0d99ff',
  '#7c3aed',
  '#db2777',
  '#ffffff',
];

const STROKE_WIDTHS = [1, 2, 4, 8, 16];
const FONT_SIZES = [12, 16, 20, 24, 32, 48];

export function PropertiesPanel(): React.JSX.Element | null {
  const [selectedId, setSelectedId] = useState<string | null>(boardStore.selectedId);
  const [obj, setObj] = useState<Obj | null>(
    boardStore.selectedId ? boardStore.view.objects[boardStore.selectedId] ?? null : null,
  );

  // Local inputs state for X, Y, W, H
  const [posInputs, setPosInputs] = useState({ x: '0', y: '0', w: '0', h: '0' });

  useEffect(() => {
    return boardStore.subscribe(() => {
      setSelectedId(boardStore.selectedId);
      const currentObj = boardStore.selectedId
        ? boardStore.view.objects[boardStore.selectedId] ?? null
        : null;
      setObj(currentObj);

      if (currentObj && !currentObj.deleted) {
        const p = currentObj.props;
        if ('x' in p) {
          setPosInputs({
            x: String(Math.round(Number(p.x) || 0)),
            y: String(Math.round(Number(p.y) || 0)),
            w: String(Math.round(Number(p.width) || 0)),
            h: String(Math.round(Number(p.height) || 0)),
          });
        } else if ('x1' in p) {
          const minX = Math.min(Number(p.x1), Number(p.x2));
          const minY = Math.min(Number(p.y1), Number(p.y2));
          const w = Math.abs(Number(p.x2) - Number(p.x1));
          const h = Math.abs(Number(p.y2) - Number(p.y1));
          setPosInputs({
            x: String(Math.round(minX)),
            y: String(Math.round(minY)),
            w: String(Math.round(w)),
            h: String(Math.round(h)),
          });
        }
      }
    });
  }, []);

  const handlePosChange = (key: 'x' | 'y' | 'w' | 'h', value: string) => {
    setPosInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handlePosCommit = () => {
    if (!obj || !selectedId) return;

    const newX = parseFloat(posInputs.x);
    const newY = parseFloat(posInputs.y);
    const newW = Math.max(1, parseFloat(posInputs.w));
    const newH = Math.max(1, parseFloat(posInputs.h));

    if (isNaN(newX) || isNaN(newY) || isNaN(newW) || isNaN(newH)) return;

    const changes: Record<string, unknown> = {};
    if ('x' in obj.props) {
      changes.x = newX;
      changes.y = newY;
      if ('width' in obj.props) changes.width = newW;
      if ('height' in obj.props) changes.height = newH;
    }

    if (Object.keys(changes).length > 0) {
      boardStore.submit({
        type: 'SET_PROPS',
        objectId: selectedId,
        changes,
      });
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    key: 'x' | 'y' | 'w' | 'h',
  ) => {
    if (e.key === 'Enter') {
      handlePosCommit();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      // Revert
      if (obj) {
        setPosInputs({
          x: String(Math.round(Number(obj.props.x) || 0)),
          y: String(Math.round(Number(obj.props.y) || 0)),
          w: String(Math.round(Number(obj.props.width) || 0)),
          h: String(Math.round(Number(obj.props.height) || 0)),
        });
      }
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const delta = e.key === 'ArrowUp' ? step : -step;
      const current = parseFloat(posInputs[key]) || 0;
      const updated = current + delta;
      setPosInputs((prev) => ({ ...prev, [key]: String(updated) }));
      setTimeout(handlePosCommit, 0);
    }
  };

  const handleColorSelect = (target: 'fill' | 'stroke', color: string) => {
    if (target === 'fill') {
      boardStore.setStyle({ fill: color });
    } else {
      boardStore.setStyle({ stroke: color });
    }
  };

  if (!selectedId || !obj || obj.deleted) {
    return null;
  }

  const currentFill = String(obj.props.fill ?? 'none');
  const currentStroke = String(obj.props.stroke ?? obj.props.color ?? '#000000');
  const currentStrokeWidth = Number(obj.props.strokeWidth ?? 2);
  const currentFontSize = Number(obj.props.fontSize ?? 16);

  return (
    <aside
      className="glass-panel"
      style={{
        position: 'fixed',
        top: 72,
        right: 16,
        width: 240,
        maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto',
        padding: 14,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Position & Size */}
      {'x' in obj.props && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
            POSITION & SIZE
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-panel-hover)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>X</span>
              <input
                type="number"
                value={posInputs.x}
                onChange={(e) => handlePosChange('x', e.target.value)}
                onBlur={handlePosCommit}
                onKeyDown={(e) => handleKeyDown(e, 'x')}
                style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-panel-hover)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Y</span>
              <input
                type="number"
                value={posInputs.y}
                onChange={(e) => handlePosChange('y', e.target.value)}
                onBlur={handlePosCommit}
                onKeyDown={(e) => handleKeyDown(e, 'y')}
                style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 12 }}
              />
            </div>
            {'width' in obj.props && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-panel-hover)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>W</span>
                  <input
                    type="number"
                    value={posInputs.w}
                    onChange={(e) => handlePosChange('w', e.target.value)}
                    onBlur={handlePosCommit}
                    onKeyDown={(e) => handleKeyDown(e, 'w')}
                    style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 12 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-panel-hover)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>H</span>
                  <input
                    type="number"
                    value={posInputs.h}
                    onChange={(e) => handlePosChange('h', e.target.value)}
                    onBlur={handlePosCommit}
                    onKeyDown={(e) => handleKeyDown(e, 'h')}
                    style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 12 }}
                  />
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* Fill Color */}
      {'fill' in obj.props && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>FILL</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button
              onClick={() => handleColorSelect('fill', 'none')}
              style={{
                width: 20,
                height: 20,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-strong)',
                background: 'linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)',
                boxShadow: currentFill === 'none' ? '0 0 0 2px var(--accent-primary)' : 'none',
              }}
              data-tooltip="None"
              aria-label="No fill"
            />
            {COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                onClick={() => handleColorSelect('fill', color)}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: color,
                  border: '1px solid var(--border-strong)',
                  boxShadow: currentFill === color ? '0 0 0 2px var(--accent-primary)' : 'none',
                }}
                data-tooltip={color}
                aria-label={`Fill ${color}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Stroke / Text Color */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
          {obj.type === 'text' ? 'TEXT COLOR' : 'STROKE'}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              onClick={() => handleColorSelect('stroke', color)}
              style={{
                width: 20,
                height: 20,
                borderRadius: 'var(--radius-sm)',
                backgroundColor: color,
                border: '1px solid var(--border-strong)',
                boxShadow: currentStroke === color ? '0 0 0 2px var(--accent-primary)' : 'none',
              }}
              data-tooltip={color}
              aria-label={`Stroke ${color}`}
            />
          ))}
        </div>
      </section>

      {/* Stroke Width */}
      {'strokeWidth' in obj.props && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
            STROKE WIDTH
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {STROKE_WIDTHS.map((width) => (
              <button
                key={width}
                onClick={() => boardStore.setStyle({ strokeWidth: width })}
                className="icon-btn"
                style={{
                  flex: 1,
                  height: 26,
                  fontSize: 11,
                  fontWeight: currentStrokeWidth === width ? 700 : 400,
                  background:
                    currentStrokeWidth === width ? 'var(--accent-light)' : 'var(--bg-panel-hover)',
                  color:
                    currentStrokeWidth === width ? 'var(--accent-primary)' : 'var(--text-main)',
                }}
              >
                {width}px
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Font Size for Text */}
      {obj.type === 'text' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>FONT SIZE</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {FONT_SIZES.map((size) => (
              <button
                key={size}
                onClick={() => boardStore.setStyle({ fontSize: size })}
                className="icon-btn"
                style={{
                  width: 32,
                  height: 26,
                  fontSize: 11,
                  fontWeight: currentFontSize === size ? 700 : 400,
                  background:
                    currentFontSize === size ? 'var(--accent-light)' : 'var(--bg-panel-hover)',
                  color: currentFontSize === size ? 'var(--accent-primary)' : 'var(--text-main)',
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Layer Ordering & Actions */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>LAYER ORDER</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4 }}>
          <button
            className="icon-btn"
            onClick={() => boardStore.reorderSelection('front')}
            data-tooltip="Bring to Front (Ctrl+])"
            aria-label="Bring to Front"
          >
            <ChevronsUp size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => boardStore.reorderSelection('forward')}
            data-tooltip="Bring Forward (])"
            aria-label="Bring Forward"
          >
            <ChevronUp size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => boardStore.reorderSelection('backward')}
            data-tooltip="Send Backward ([)"
            aria-label="Send Backward"
          >
            <ChevronDown size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => boardStore.reorderSelection('back')}
            data-tooltip="Send to Back (Ctrl+[)"
            aria-label="Send to Back"
          >
            <ChevronsDown size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button
            onClick={() => boardStore.duplicateSelection()}
            className="icon-btn"
            style={{ flex: 1, height: 28, gap: 4, fontSize: 11, background: 'var(--bg-panel-hover)' }}
          >
            <Copy size={13} />
            Duplicate
          </button>
          <button
            onClick={() => boardStore.deleteSelection()}
            className="icon-btn"
            style={{
              flex: 1,
              height: 28,
              gap: 4,
              fontSize: 11,
              background: 'var(--danger-light)',
              color: 'var(--danger)',
            }}
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      </section>
    </aside>
  );
}
