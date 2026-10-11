import React, { useEffect, useState } from 'react';
import {
  MousePointer,
  Square,
  Circle,
  Minus,
  PenTool as PenIcon,
  Type,
  Hand,
  Lock,
} from 'lucide-react';
import { boardStore, type ToolType } from '../store/boardStore.js';

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ size?: number }>;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', icon: Square },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: Circle },
  { id: 'line', label: 'Line', shortcut: 'L', icon: Minus },
  { id: 'pen', label: 'Pen', shortcut: 'P', icon: PenIcon },
  { id: 'text', label: 'Text', shortcut: 'T', icon: Type },
  { id: 'hand', label: 'Hand', shortcut: 'H', icon: Hand },
];

export function Toolbar(): React.JSX.Element {
  const [activeTool, setActiveTool] = useState<ToolType>(boardStore.activeTool);
  const [isLocked, setIsLocked] = useState<boolean>(boardStore.isToolLocked);
  const [lastClick, setLastClick] = useState<{ id: ToolType; time: number }>({
    id: 'select',
    time: 0,
  });

  useEffect(() => {
    return boardStore.subscribe(() => {
      setActiveTool(boardStore.activeTool);
      setIsLocked(boardStore.isToolLocked);
    });
  }, []);

  const handleToolClick = (toolId: ToolType) => {
    const now = Date.now();
    const isDouble = lastClick.id === toolId && now - lastClick.time < 350;
    setLastClick({ id: toolId, time: now });

    if (isDouble && toolId !== 'select' && toolId !== 'hand') {
      boardStore.setActiveTool(toolId, !isLocked);
    } else {
      boardStore.setActiveTool(toolId, isDouble ? !isLocked : false);
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 8px',
        zIndex: 50,
      }}
    >
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        const isActive = activeTool === tool.id;

        return (
          <button
            key={tool.id}
            className={`icon-btn ${isActive ? 'active' : ''}`}
            onClick={() => handleToolClick(tool.id)}
            data-tooltip={`${tool.label} (${tool.shortcut})`}
            aria-label={`${tool.label} (${tool.shortcut})`}
            style={{ position: 'relative' }}
          >
            <Icon size={18} />
            {isActive && isLocked && tool.id !== 'select' && (
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  color: 'var(--accent-primary)',
                }}
              >
                <Lock size={8} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
