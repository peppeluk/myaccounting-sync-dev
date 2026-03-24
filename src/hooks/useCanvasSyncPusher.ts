// ============================================================
// useCanvasSyncPusher.ts
// Hook per sincronizzazione canvas tramite Pusher
// ============================================================

import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import Pusher from 'pusher-js';

export type ConnectedUser = {
  clientId: string;
  nickname?: string;
  ipAddress?: string;
  connectedAt: number;
};

export type SyncState = {
  isConnected: boolean;
  currentRoom: string | null;
  connectedUsers: ConnectedUser[];
};

export type JournalSyncState = {
  entries: any[];
  selectedProfileId?: string;
  isJournalOpen?: boolean;
  isCalculatorOpen?: boolean;
  calculatorDisplay?: string;
  selectedField?: {
    entryId: string;
    field: string;
  } | null;
  calculatorTarget?: {
    entryId: string;
    field: string;
  } | null;
  journalScroll?: {
    top: number;
    left: number;
  } | null;
};

export type BoardSyncState = {
  pageCount: number;
  currentPageIndex: number;
  scrollTop: number;
  scrollLeft: number;
};

export type JournalSyncHandlers = {
  getState: () => JournalSyncState;
  onState: (state: JournalSyncState) => void;
  onAction: (action: any) => void;
};

export type BoardSyncHandlers = {
  getState: () => BoardSyncState;
  onState: (state: BoardSyncState) => void;
  onAction: (action: any) => void;
};

export type SyncActions = {
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  sendJournalAction: (action: any) => void;
  sendJournalState: (state: JournalSyncState) => void;
  sendBoardState: (state: BoardSyncState) => void;
  sendCanvasFullState: () => void;
};

export type SyncRefs = {
  wsRef: React.MutableRefObject<any>;
  clientIdRef: React.MutableRefObject<string>;
  currentRoomRef: React.MutableRefObject<string | null>;
  isApplyingRemoteChangeRef: React.MutableRefObject<boolean>;
};

function isCanvasUsable(canvas: any | null): boolean {
  if (!canvas) return false;
  if ((canvas as any)._isDisposed) return false;
  const hasCoreApi =
    typeof (canvas as any).add === 'function' &&
    typeof (canvas as any).getObjects === 'function' &&
    typeof (canvas as any).loadFromJSON === 'function';
  return hasCoreApi;
}

function renderIfReady(canvas: any | null): void {
  if (!canvas) return;
  if ((canvas as any).contextContainer && typeof (canvas as any).renderAll === 'function') {
    console.log('🎨 [SYNC] Forcing canvas render with', canvas.getObjects().length, 'objects');
    canvas.renderAll();
    // Forza un render aggiuntivo per assicurarci che sia visibile
    requestAnimationFrame(() => {
      if (canvas && typeof canvas.renderAll === 'function') {
        console.log('🎨 [SYNC] Second render pass for visibility');
        canvas.renderAll();
      }
    });
  } else {
    console.warn('🎨 [SYNC] Canvas not ready for rendering');
  }
}

/**
 * Hook per sincronizzazione canvas in tempo reale con Pusher
 * 
 * @param canvasRef - Ref al canvas Fabric.js da sincronizzare
 * @param appKey - Chiave app Pusher
 * @param cluster - Cluster Pusher (es: 'eu')
 * @param documentId - ID documento per MBD
 * @param journalSync - Handler per sincronizzazione journal
 * @param boardSync - Handler per sincronizzazione board
 * @returns Stato connessione e azioni per gestire le stanze
 * 
 * @example
 * const { isConnected, currentRoom, joinRoom, leaveRoom } = useCanvasSyncPusher(
 *   canvasRef.current,
 *   'your-pusher-app-key',
 *   'eu'
 * );
 */
export function useCanvasSyncPusher(
  canvasRef: RefObject<any>,
  appKey: string,
  cluster: string,
  journalSync?: JournalSyncHandlers,
  boardSync?: BoardSyncHandlers
): SyncState & SyncActions & SyncRefs {
  const pusherRef = useRef<Pusher | null>(null);
  const channelRef = useRef<any>(null);
  const clientIdRef = useRef<string>(
    `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const currentRoomRef = useRef<string | null>(null);
  const isApplyingRemoteChangeRef = useRef(false);
  const journalSyncRef = useRef<JournalSyncHandlers | null>(journalSync ?? null);
  const boardSyncRef = useRef<BoardSyncHandlers | null>(boardSync ?? null);

  const [isConnected, setIsConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);

  useEffect(() => {
    journalSyncRef.current = journalSync ?? null;
  }, [journalSync]);

  useEffect(() => {
    boardSyncRef.current = boardSync ?? null;
  }, [boardSync]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  // Inizializza Pusher
  useEffect(() => {
    if (!appKey) return;

    console.log('[Pusher] Initializing with appKey:', appKey);
    
    const pusher = new Pusher(appKey, {
      cluster: cluster,
      forceTLS: true
    });

    pusherRef.current = pusher;

    pusher.connection.bind('connected', () => {
      console.log('[Pusher] Connected');
      setIsConnected(true);
    });

    pusher.connection.bind('disconnected', () => {
      console.log('[Pusher] Disconnected');
      setIsConnected(false);
      setCurrentRoom(null);
      setConnectedUsers([]);
    });

    pusher.connection.bind('error', (error: any) => {
      console.error('[Pusher] Connection error:', error);
    });

    return () => {
      if (channelRef.current) {
        channelRef.current.unbind_all();
        channelRef.current.unsubscribe();
      }
      pusher.disconnect();
    };
  }, [appKey, cluster]);

  const joinRoom = useCallback((roomId: string) => {
    if (!pusherRef.current) {
      console.error('[Pusher] Not initialized');
      return;
    }

    // Unbind from previous channel if exists
    if (channelRef.current) {
      channelRef.current.unbind_all();
      channelRef.current.unsubscribe();
    }

    console.log('[Pusher] Joining room:', roomId);
    
    const channel = pusherRef.current.subscribe(roomId);
    channelRef.current = channel;

    channel.bind('pusher:subscription_succeeded', () => {
      console.log('[Pusher] Subscription succeeded');
      setCurrentRoom(roomId);
    });

    // Canvas sync events
    channel.bind('client-canvas-full', (data: any) => {
      console.log('[Pusher] Received canvas-full:', data);
      handleCanvasFullState(data);
    });

    channel.bind('client-canvas-update', (data: any) => {
      console.log('[Pusher] Received canvas-update:', data);
      handleCanvasUpdate(data);
    });

    // Journal sync events
    channel.bind('client-journal-action', (data: any) => {
      console.log('[Pusher] Received journal-action:', data);
      journalSyncRef.current?.onAction(data);
    });

    channel.bind('client-journal-state', (data: any) => {
      console.log('[Pusher] Received journal-state:', data);
      journalSyncRef.current?.onState(data);
    });

    // Board sync events
    channel.bind('client-board-action', (data: any) => {
      console.log('[Pusher] Received board-action:', data);
      boardSyncRef.current?.onAction(data);
    });

    channel.bind('client-board-state', (data: any) => {
      console.log('[Pusher] Received board-state:', data);
      boardSyncRef.current?.onState(data);
    });

  }, []);

  const leaveRoom = useCallback(() => {
    if (channelRef.current) {
      console.log('[Pusher] Leaving room:', currentRoomRef.current);
      channelRef.current.unbind_all();
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }
    setCurrentRoom(null);
    setConnectedUsers([]);
  }, []);

  const handleCanvasFullState = useCallback((data: any) => {
    const activeCanvas = canvasRef.current;
    if (!activeCanvas || !isCanvasUsable(activeCanvas)) {
      console.warn('[Pusher] Canvas not ready for full state');
      return;
    }

    isApplyingRemoteChangeRef.current = true;

    try {
      if (data.canvasData) {
        activeCanvas.loadFromJSON(data.canvasData, () => {
          renderIfReady(activeCanvas);
          console.log('[Pusher] Canvas full state applied');
        });
      }

      // Apply background mode if present
      if (data.backgroundMode && typeof (window as any).setBackgroundMode === 'function') {
        (window as any).isApplyingRemoteBackgroundMode = true;
        (window as any).setBackgroundMode(data.backgroundMode);
        setTimeout(() => {
          (window as any).isApplyingRemoteBackgroundMode = false;
        }, 100);
      }
    } catch (error) {
      console.error('[Pusher] Error applying canvas full state:', error);
    } finally {
      setTimeout(() => {
        isApplyingRemoteChangeRef.current = false;
      }, 25);
    }
  }, [canvasRef]);

  const handleCanvasUpdate = useCallback((data: any) => {
    const activeCanvas = canvasRef.current;
    if (!activeCanvas || !isCanvasUsable(activeCanvas)) {
      console.warn('[Pusher] Canvas not ready for update');
      return;
    }

    isApplyingRemoteChangeRef.current = true;

    try {
      // Apply individual canvas updates
      if (data.objects) {
        data.objects.forEach((obj: any) => {
          // Implementation depends on your canvas update format
          console.log('[Pusher] Applying canvas object:', obj);
        });
        renderIfReady(activeCanvas);
      }
    } catch (error) {
      console.error('[Pusher] Error applying canvas update:', error);
    } finally {
      setTimeout(() => {
        isApplyingRemoteChangeRef.current = false;
      }, 25);
    }
  }, [canvasRef]);

  const sendCanvasFullState = useCallback(() => {
    const activeCanvas = canvasRef.current;
    if (!activeCanvas || !channelRef.current) return;

    try {
      const canvasData = activeCanvas.toJSON();
      const backgroundMode = (window as any).appBackgroundMode;

      const message = {
        type: 'canvas-full',
        clientId: clientIdRef.current,
        timestamp: Date.now(),
        canvasData: canvasData,
        backgroundMode: backgroundMode
      };

      console.log('[Pusher] Sending canvas-full state');
      channelRef.current.trigger('client-canvas-full', message);
    } catch (error) {
      console.error('[Pusher] Error sending canvas full state:', error);
    }
  }, [canvasRef]);

  const sendJournalAction = useCallback((action: any) => {
    if (!channelRef.current) return;

    const message = {
      type: 'journal-action',
      clientId: clientIdRef.current,
      timestamp: Date.now(),
      action
    };

    console.log('[Pusher] Sending journal-action:', message);
    channelRef.current.trigger('client-journal-action', message);
  }, []);

  const sendJournalState = useCallback((state: JournalSyncState) => {
    if (!channelRef.current) return;

    const message = {
      type: 'journal-state',
      clientId: clientIdRef.current,
      timestamp: Date.now(),
      state
    };

    console.log('[Pusher] Sending journal-state:', message);
    channelRef.current.trigger('client-journal-state', message);
  }, []);

  const sendBoardState = useCallback((state: BoardSyncState) => {
    if (!channelRef.current) return;

    const message = {
      type: 'board-state',
      clientId: clientIdRef.current,
      timestamp: Date.now(),
      state
    };

    console.log('[Pusher] Sending board-state:', message);
    channelRef.current.trigger('client-board-state', message);
  }, []);

  return {
    isConnected,
    currentRoom,
    connectedUsers,
    joinRoom,
    leaveRoom,
    sendJournalAction,
    sendJournalState,
    sendBoardState,
    sendCanvasFullState,
    wsRef: pusherRef,
    clientIdRef,
    currentRoomRef,
    isApplyingRemoteChangeRef
  };
}
