import React from 'react';

interface ShortcutGroup {
  category: string;
  items: { keys: string[]; description: string }[];
}

const SHORTCUTS: ShortcutGroup[] = [
  {
    category: 'Tools',
    items: [
      { keys: ['V', '1'], description: 'Select & Transform tool' },
      { keys: ['R', '2'], description: 'Rectangle shape' },
      { keys: ['O', '3'], description: 'Ellipse shape' },
      { keys: ['L', '4'], description: 'Straight Line' },
      { keys: ['P', '5'], description: 'Freehand Pen' },
      { keys: ['T', '6'], description: 'Text element' },
      { keys: ['H'], description: 'Hand / Pan tool' },
    ],
  },
  {
    category: 'Canvas & Navigation',
    items: [
      { keys: ['Space', 'Drag'], description: 'Pan viewport' },
      { keys: ['Ctrl', 'Wheel'], description: 'Zoom at cursor' },
      { keys: ['+', '-'], description: 'Zoom In / Out' },
      { keys: ['Shift', '0'], description: 'Reset Zoom (100%)' },
      { keys: ['Shift', 'Drag'], description: 'Lock aspect ratio / 45° angle' },
    ],
  },
  {
    category: 'Editing & Layering',
    items: [
      { keys: ['Ctrl', 'Z'], description: 'Undo action' },
      { keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo action' },
      { keys: ['Ctrl', 'D'], description: 'Duplicate selection (+16px)' },
      { keys: ['Ctrl', 'C'], description: 'Copy to clipboard' },
      { keys: ['Ctrl', 'V'], description: 'Paste copied object' },
      { keys: ['Del', 'Bksp'], description: 'Delete selected object' },
      { keys: ['Arrow Keys'], description: 'Move selection (Shift: fast move)' },
      { keys: ['[', ']'], description: 'Send backward / forward' },
      { keys: ['Esc'], description: 'Clear selection & guides' },
    ],
  },
];

export function ShortcutCheatsheet(): React.JSX.Element {
  return (
    <div
      className="glass-panel"
      style={{
        width: 440,
        padding: '16px 20px',
        maxHeight: '80vh',
        overflowY: 'auto',
        fontSize: 12,
        color: 'var(--text-main)',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>⌨️</span> Keyboard Shortcuts
        </h3>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Whiteboard Quick Reference</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {SHORTCUTS.map((group) => (
          <div key={group.category}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-primary)', marginBottom: 6 }}>
              {group.category}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.items.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '3px 0',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>{item.description}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {item.keys.map((k, kIdx) => (
                      <kbd
                        key={kIdx}
                        style={{
                          background: 'var(--bg-panel-active)',
                          color: 'var(--text-main)',
                          border: '1px solid var(--border-strong)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '2px 6px',
                          fontSize: 10,
                          fontWeight: 600,
                          fontFamily: 'var(--font-mono)',
                          boxShadow: '0 1px 0 rgba(0,0,0,0.1)',
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
