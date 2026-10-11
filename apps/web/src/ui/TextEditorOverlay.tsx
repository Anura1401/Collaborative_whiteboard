import React, { useEffect, useRef, useState } from 'react';
import type { Point, Obj } from '@whiteboard/shared';
import { worldToScreen, type Camera } from '../canvas/camera.js';
import { boardStore } from '../store/boardStore.js';

interface TextEditorOverlayProps {
  worldPos: Point;
  existingTextId?: string;
  camera: Camera;
  onClose: () => void;
}

export function TextEditorOverlay({
  worldPos,
  existingTextId,
  camera,
  onClose,
}: TextEditorOverlayProps): React.JSX.Element {
  const existingObj = existingTextId ? boardStore.view.objects[existingTextId] : undefined;
  const initialText = existingObj ? String(existingObj.props.text ?? '') : '';
  const initialFontSize = existingObj ? Number(existingObj.props.fontSize ?? 16) : boardStore.style.fontSize;
  const initialColor = existingObj ? String(existingObj.props.color ?? '#000000') : boardStore.style.stroke;
  const initialWidth = existingObj ? Number(existingObj.props.width ?? 200) : 200;

  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isCommittedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.select();
        // Auto-adjust height
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.max(32, textareaRef.current.scrollHeight)}px`;
      }
    }, 20);

    return () => clearTimeout(timer);
  }, []);

  const screenPos = worldToScreen(worldPos, camera);
  const scaledFontSize = Math.max(12, initialFontSize * camera.zoom);
  const scaledWidth = Math.max(160, initialWidth * camera.zoom);

  const commit = () => {
    if (isCommittedRef.current) return;
    isCommittedRef.current = true;

    const trimmed = text.trim();
    if (!trimmed) {
      onClose();
      return;
    }

    if (existingTextId && existingObj) {
      if (trimmed !== initialText) {
        boardStore.submit({
          type: 'SET_PROPS',
          objectId: existingTextId,
          changes: { text: trimmed },
        });
      }
    } else {
      const newId = crypto.randomUUID();
      const textObj: Obj = {
        id: newId,
        type: 'text',
        deleted: false,
        props: {
          x: Math.round(worldPos.x),
          y: Math.round(worldPos.y),
          width: Math.max(20, Math.round(initialWidth)),
          text: trimmed,
          fontSize: initialFontSize,
          color: initialColor,
        },
      };

      boardStore.submit({
        type: 'CREATE_OBJECT',
        object: textObj,
      });
      boardStore.setSelected(newId);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      isCommittedRef.current = true;
      onClose();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(32, textareaRef.current.scrollHeight)}px`;
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: screenPos.x,
        top: screenPos.y,
        zIndex: 100,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder="Type text (Enter to finish)..."
        style={{
          width: scaledWidth,
          minHeight: scaledFontSize * 1.5,
          fontSize: `${scaledFontSize}px`,
          lineHeight: 1.3,
          color: initialColor === '#ffffff' ? '#ffffff' : 'var(--text-main)',
          fontFamily: 'Inter, system-ui, sans-serif',
          background: 'var(--bg-panel)',
          border: '1.5px solid var(--accent-primary)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          outline: 'none',
          resize: 'none',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          display: 'block',
        }}
      />
    </div>
  );
}
