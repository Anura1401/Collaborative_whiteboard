import React, { useEffect, useRef, useState } from 'react';
import type { Point } from '@whiteboard/shared';
import { CanvasEngine } from '../canvas/CanvasEngine.js';
import { createDefaultCamera, setZoomAt, zoomAt, type Camera } from '../canvas/camera.js';
import { boardStore, type ConnectionStatus } from '../store/boardStore.js';
import { Connection } from '../net/Connection.js';
import { TopBar } from '../ui/TopBar.js';
import { Toolbar } from '../ui/Toolbar.js';
import { LayersPanel } from '../ui/LayersPanel.js';
import { PropertiesPanel } from '../ui/PropertiesPanel.js';
import { TextEditorOverlay } from '../ui/TextEditorOverlay.js';
import { ContextMenu } from '../ui/ContextMenu.js';
import { Toasts } from '../ui/Toasts.js';
import { MousePointer, Square, Type, Share2, WifiOff, Loader2 } from 'lucide-react';

interface BoardViewProps {
  boardId: string;
}

export function BoardView({ boardId }: BoardViewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CanvasEngine | null>(null);

  const [boardName, setBoardName] = useState('Whiteboard');
  const [camera, setCamera] = useState<Camera>(createDefaultCamera());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(boardStore.status);

  const [textEditorState, setTextEditorState] = useState<{
    isOpen: boolean;
    pos: Point;
    existingTextId?: string;
  }>({
    isOpen: false,
    pos: { x: 0, y: 0 },
  });

  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
  });

  const [hasObjects, setHasObjects] = useState(boardStore.view.order.length > 0);

  useEffect(() => {
    return boardStore.subscribe(() => {
      setHasObjects(boardStore.view.order.length > 0);
      setConnectionStatus(boardStore.status);
    });
  }, []);

  // Fetch board info and initialize WebSocket connection
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || '';
    fetch(`${apiUrl}/api/boards/${boardId}`)
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Board not found');
      })
      .then((data) => {
        if (data.name) setBoardName(data.name);
      })
      .catch((err) => console.warn('Could not fetch board metadata:', err));

    const conn = new Connection(boardId, {
      onStatusChange: (status) => boardStore.setStatus(status),
      onMessage: (msg) => boardStore.handleServerMessage(msg),
      getLastSeq: () => boardStore.lastSeq,
      onLiveReady: () => boardStore.onLiveReady(),
    });

    boardStore.setConnection(conn);
    conn.connect();

    return () => {
      conn.destroy();
      boardStore.setConnection(null);
    };
  }, [boardId]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new CanvasEngine(
      canvasRef.current,
      boardStore,
      (worldPos, existingTextId) => {
        setTextEditorState({
          isOpen: true,
          pos: worldPos,
          existingTextId,
        });
      },
      (newCam) => {
        setCamera({ ...newCam });
      },
    );

    engineRef.current = engine;

    return () => {
      engine.destroy();
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleZoomIn = () => {
    if (!canvasRef.current || !engineRef.current) return;
    const center = { x: canvasRef.current.width / 2, y: canvasRef.current.height / 2 };
    const next = zoomAt(camera, center, 1.25);
    engineRef.current.setCamera(next);
  };

  const handleZoomOut = () => {
    if (!canvasRef.current || !engineRef.current) return;
    const center = { x: canvasRef.current.width / 2, y: canvasRef.current.height / 2 };
    const next = zoomAt(camera, center, 0.8);
    engineRef.current.setCamera(next);
  };

  const handleResetZoom = () => {
    if (!canvasRef.current || !engineRef.current) return;
    const center = { x: canvasRef.current.width / 2, y: canvasRef.current.height / 2 };
    const next = setZoomAt(camera, center, 1.0);
    engineRef.current.setCamera(next);
  };

  const isDisconnected = connectionStatus === 'DISCONNECTED';
  const isConnecting = connectionStatus === 'CONNECTING' || connectionStatus === 'SYNCING';

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
      }}
      onClick={() => {
        if (contextMenu.isOpen) {
          setContextMenu((prev) => ({ ...prev, isOpen: false }));
        }
      }}
      onContextMenu={handleContextMenu}
    >
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
        }}
      />

      {/* Disconnected / Reconnecting banner */}
      {isDisconnected && (
        <div
          style={{
            position: 'fixed',
            top: 68,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--danger)',
            color: '#ffffff',
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 100,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <WifiOff size={14} />
          <span>Disconnected (Read-only mode). Reconnecting...</span>
        </div>
      )}

      {isConnecting && !isDisconnected && (
        <div
          style={{
            position: 'fixed',
            top: 68,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--accent-primary)',
            color: '#ffffff',
            padding: '4px 12px',
            borderRadius: 'var(--radius-full)',
            fontSize: 11,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            zIndex: 100,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <Loader2 size={12} className="animate-spin" />
          <span>Connecting to server...</span>
        </div>
      )}

      {/* Empty State Welcome Guide */}
      {!hasObjects && connectionStatus === 'LIVE' && (
        <div
          className="glass-panel"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '24px 32px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            pointerEvents: 'none',
            maxWidth: 380,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-full)',
              background: 'var(--accent-light)',
              color: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MousePointer size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Empty Whiteboard</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Start collaborating with instant real-time sync.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Square size={15} color="var(--accent-primary)" />
              <span>
                Draw shapes with <b>R</b> or <b>O</b>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Type size={15} color="var(--accent-primary)" />
              <span>
                Add text with <b>T</b> or double click
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Share2 size={15} color="var(--accent-primary)" />
              <span>Share link to invite teammates</span>
            </div>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <TopBar
        boardName={boardName}
        onBoardNameChange={setBoardName}
        camera={camera}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
      />

      {/* Left Layers Panel */}
      <LayersPanel />

      {/* Floating Bottom Toolbar */}
      <Toolbar />

      {/* Right Contextual Properties Panel */}
      <PropertiesPanel />

      {/* Text Editor In-place Overlay */}
      {textEditorState.isOpen && (
        <TextEditorOverlay
          worldPos={textEditorState.pos}
          existingTextId={textEditorState.existingTextId}
          camera={camera}
          onClose={() => setTextEditorState((prev) => ({ ...prev, isOpen: false }))}
        />
      )}

      {/* Context Menu */}
      {contextMenu.isOpen && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu((prev) => ({ ...prev, isOpen: false }))}
        />
      )}

      {/* Notification Toasts */}
      <Toasts />
    </div>
  );
}
