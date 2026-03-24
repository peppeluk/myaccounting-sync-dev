// ============================================================
// useCanvasSyncFirebase.ts
// Hook per sincronizzazione canvas tramite Firebase Realtime Database
// ============================================================

import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, onValue, onChildAdded, serverTimestamp, set, remove } from 'firebase/database';

// Configurazione Firebase
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Inizializza Firebase
let app: any = null;
let database: any = null;

try {
  if (firebaseConfig.apiKey) {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    console.log('[Firebase] App initialized successfully');
  } else {
    console.warn('[Firebase] Missing configuration');
  }
} catch (error) {
  console.error('[Firebase] Initialization error:', error);
}

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
  wsRef: any;
  clientIdRef: React.MutableRefObject<string>;
  currentRoomRef: React.MutableRefObject<string | null>;
};

/**
 * Hook per sincronizzazione canvas in tempo reale con Firebase Realtime Database
 * 
 * @param canvasRef - Ref al canvas Fabric.js da sincronizzare
 * @param journalSync - Handler per sincronizzazione journal
 * @param boardSync - Handler per sincronizzazione board
 * @returns Stato connessione e azioni per gestire le stanze
 */
export function useCanvasSyncFirebase(
  canvasRef: RefObject<any>,
  journalSync?: JournalSyncHandlers,
  boardSync?: BoardSyncHandlers
): SyncState & SyncActions & SyncRefs {
  
  // Stati
  const [isConnected, setIsConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);

  // Refs
  const wsRef = useRef<any>(null);
  const clientIdRef = useRef<string>(`client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const currentRoomRef = useRef<string | null>(null);
  const listenersRef = useRef<any[]>([]);

  // Pulisci listeners quando cambia stanza
  const clearListeners = useCallback(() => {
    listenersRef.current.forEach(unsubscribe => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    });
    listenersRef.current = [];
  }, []);

  // Unisciti alla stanza
  const joinRoom = useCallback((roomId: string) => {
    if (!database) {
      console.warn('[Firebase] Cannot join room - Firebase not initialized');
      return;
    }

    console.log('[Firebase] Joining room:', roomId);
    
    // Pulisci listeners precedenti
    clearListeners();
    
    // Aggiorna stato
    setCurrentRoom(roomId);
    currentRoomRef.current = roomId;
    setIsConnected(true);

    // Riferimenti ai nodi Firebase
    const usersRef = ref(database, `rooms/${roomId}/users`);
    const canvasEventsRef = ref(database, `rooms/${roomId}/canvas`);
    const journalDataRef = ref(database, `rooms/${roomId}/journal`);
    const boardDataRef = ref(database, `rooms/${roomId}/board`);

    // Aggiungi utente alla stanza
    const newUserRef = push(usersRef);
    const userKey = newUserRef.key;
    set(newUserRef, {
      clientId: clientIdRef.current,
      connectedAt: serverTimestamp()
    });

    // Ascolta utenti connessi
    const usersListener = onValue(usersRef, (snapshot) => {
      const users = snapshot.val() || {};
      const usersList = Object.values(users).map((user: any) => ({
        ...user,
        connectedAt: user.connectedAt || Date.now()
      }));
      setConnectedUsers(usersList);
    });

    // Ascolta eventi canvas
    const canvasListener = onChildAdded(canvasEventsRef, (snapshot) => {
      const data = snapshot.val();
      if (data.clientId !== clientIdRef.current && canvasRef.current && data.state) {
        console.log('[Firebase] Received canvas data:', data);
        
        // Applica dati al canvas
        try {
          const fabricModule = (window as any).fabric;
          if (fabricModule && data.state.objects && Array.isArray(data.state.objects)) {
            // Pulisci canvas esistente
            canvasRef.current.clear();
            
            // Ricrea gli oggetti dallo stato ricevuto
            data.state.objects.forEach((objData: any) => {
              try {
                const obj = fabricModule.util.enlivenObjects([objData])[0];
                if (obj) {
                  canvasRef.current.add(obj);
                }
              } catch (error) {
                console.warn('[Firebase] Error recreating object:', error);
              }
            });
            
            // Imposta background e viewport
            if (data.state.background) {
              canvasRef.current.backgroundColor = data.state.background;
            }
            if (data.state.viewportTransform) {
              canvasRef.current.setViewportTransform(data.state.viewportTransform);
            }
            
            // Renderizza il canvas
            canvasRef.current.renderAll();
            
            console.log('[Firebase] Canvas state applied successfully with', data.state.objects.length, 'objects');
            
            // Trigger evento per notificare l'applicazione
            window.dispatchEvent(new CustomEvent('sync-canvas-remote-applied', {
              detail: { source: 'firebase' }
            }));
          }
        } catch (error) {
          console.error('[Firebase] Error applying canvas state:', error);
        }
      }
    });

    // Ascolta eventi journal
    const journalListener = onChildAdded(journalDataRef, (snapshot) => {
      const data = snapshot.val();
      if (data.clientId !== clientIdRef.current && journalSync?.onAction) {
        console.log('[Firebase] Received journal action:', data);
        journalSync.onAction(data.action);
      }
    });

    // Ascolta eventi board
    const boardListener = onChildAdded(boardDataRef, (snapshot) => {
      const data = snapshot.val();
      if (data.clientId !== clientIdRef.current && boardSync?.onAction) {
        console.log('[Firebase] Received board action:', data);
        boardSync.onAction(data.action);
      }
    });

    // Salva listeners per cleanup
    listenersRef.current = [usersListener, canvasListener, journalListener, boardListener];

    // Cleanup quando utente lascia la pagina
    const handleUnload = () => {
      console.log('[Firebase] User leaving page, cleaning up...');
      if (userKey) {
        remove(ref(database, `rooms/${roomId}/users/${userKey}`));
      }
    };

    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    };
  }, [database, clearListeners]);

  // Lascia la stanza
  const leaveRoom = useCallback(() => {
    if (!database || !currentRoomRef.current) {
      return;
    }

    console.log('[Firebase] Leaving room:', currentRoomRef.current);
    
    // Pulisci listeners
    clearListeners();
    
    // Rimuovi utente dalla stanza
    const usersRef = ref(database, `rooms/${currentRoomRef.current}/users`);
    onValue(usersRef, (snapshot) => {
      const users = snapshot.val() || {};
      Object.entries(users).forEach(([key, user]: [string, any]) => {
        if (user.clientId === clientIdRef.current) {
          remove(ref(database, `rooms/${currentRoomRef.current}/users/${key}`));
        }
      });
    }, { onlyOnce: true });

    // Resetta stato
    setCurrentRoom(null);
    currentRoomRef.current = null;
    setConnectedUsers([]);
    setIsConnected(false);
  }, [database, clearListeners]);

  // Invia azione journal
  const sendJournalAction = useCallback((action: any) => {
    if (!database || !currentRoomRef.current) {
      console.log('[Firebase] Cannot send journal action - not connected');
      return;
    }

    const journalRef = ref(database, `rooms/${currentRoomRef.current}/journal`);
    push(journalRef, {
      clientId: clientIdRef.current,
      action,
      timestamp: serverTimestamp()
    });

    console.log('[Firebase] Sent journal action:', action);
  }, [database]);

  // Invia stato journal
  const sendJournalState = useCallback((state: JournalSyncState) => {
    if (!database || !currentRoomRef.current) {
      console.log('[Firebase] Cannot send journal state - not connected');
      return;
    }

    const journalStateRef = ref(database, `rooms/${currentRoomRef.current}/journalState`);
    set(journalStateRef, {
      clientId: clientIdRef.current,
      state,
      timestamp: serverTimestamp()
    });

    console.log('[Firebase] Sent journal state:', state);
  }, [database]);

  // Invia stato board
  const sendBoardState = useCallback((state: BoardSyncState) => {
    if (!database || !currentRoomRef.current) {
      console.log('[Firebase] Cannot send board state - not connected');
      return;
    }

    const boardStateRef = ref(database, `rooms/${currentRoomRef.current}/boardState`);
    set(boardStateRef, {
      clientId: clientIdRef.current,
      state,
      timestamp: serverTimestamp()
    });

    console.log('[Firebase] Sent board state:', state);
  }, [database]);

  // Invia stato completo canvas
  const sendCanvasFullState = useCallback(() => {
    if (!database || !currentRoomRef.current || !canvasRef.current) {
      console.log('[Firebase] Cannot send canvas state - not connected');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas.getObjects) {
      console.log('[Firebase] Canvas not ready');
      return;
    }

    try {
      // Estrai oggetti canvas
      const objects = canvas.getObjects().filter((obj: any) => {
        return !obj.isType('selection') && !obj.isType('background');
      });

      // Crea stato canvas
      const canvasState = {
        objects: objects.map((obj: any) => ({
          type: obj.type,
          left: obj.left,
          top: obj.top,
          width: obj.width,
          height: obj.height,
          fill: obj.fill,
          stroke: obj.stroke,
          strokeWidth: obj.strokeWidth,
          ...(obj.type === 'path' && { path: obj.path }),
          ...(obj.type === 'rect' && { rx: obj.rx, ry: obj.ry }),
          ...(obj.type === 'circle' && { radius: obj.radius }),
          ...(obj.type === 'text' && { 
            text: obj.text,
            fontSize: obj.fontSize,
            fontFamily: obj.fontFamily
          })
        })),
        metadata: {
          timestamp: Date.now(),
          clientId: clientIdRef.current,
          objectCount: objects.length
        }
      };

      const canvasEventsRef = ref(database, `rooms/${currentRoomRef.current}/canvas`);
      push(canvasEventsRef, {
        clientId: clientIdRef.current,
        state: canvasState,
        timestamp: serverTimestamp()
      });

      console.log('[Firebase] Sent canvas state with', objects.length, 'objects');
    } catch (error) {
      console.error('[Firebase] Error sending canvas state:', error);
    }
  }, [database, canvasRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearListeners();
      leaveRoom();
    };
  }, [clearListeners, leaveRoom]);

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
    wsRef,
    clientIdRef,
    currentRoomRef
  };
}
