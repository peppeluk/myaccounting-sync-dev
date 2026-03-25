// ============================================================
// useCanvasSyncFirebase.ts
// Hook per sincronizzazione canvas tramite Firebase Realtime Database
// ============================================================

import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getDatabase, 
  ref, 
  set, 
  push, 
  onValue, 
  onChildAdded, 
  serverTimestamp, 
  remove,
  update
} from 'firebase/database';
import * as fabric from 'fabric';

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
export const useCanvasSyncFirebase = (
  canvasRef: RefObject<any>,
  journalSync?: { onAction: (action: any) => void },
  boardSyncHandlers?: any
) => {
  const [isConnected, setIsConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [connectedUsers, setConnectedUsers] = useState(0);
  
  const clientIdRef = useRef<string>('');
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Inizializza clientId se non presente
  useEffect(() => {
    if (!clientIdRef.current) {
      clientIdRef.current = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      console.log('[Firebase] 🆔 Generated client ID:', clientIdRef.current);
    }
  }, []);
  
  // Flag per prevenire loop infinito di sincronizzazione
  const isApplyingRemoteDataRef = useRef<boolean>(false);

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
      connectedAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    });

    // Heartbeat per mantenere connessione attiva
    heartbeatIntervalRef.current = setInterval(() => {
      if (currentRoomRef.current && userKey) {
        const userRef = ref(database, `rooms/${currentRoomRef.current}/users/${userKey}`);
        update(userRef, {
          lastSeen: serverTimestamp()
        });
      }
    }, 10000); // Heartbeat ogni 10 secondi

    // Ascolta utenti connessi
    const usersListener = onValue(usersRef, (snapshot) => {
      const users = snapshot.val() || {};
      const now = Date.now();
      
      // Rimuovi utenti inattivi da più di 15 secondi
      Object.entries(users).forEach(([key, user]: [string, any]) => {
        const lastSeen = user.lastSeen || user.connectedAt;
        if (lastSeen && (now - lastSeen) > 15000) {
          console.log(`[Firebase] 🧹 Removing inactive user: ${key}`);
          remove(ref(database, `rooms/${roomId}/users/${key}`));
        }
      });
      
      const usersList = Object.values(users).map((user: any) => ({
        ...user,
        connectedAt: user.connectedAt || Date.now()
      }));
      setConnectedUsers(usersList.length);
    });

    // Ascolta eventi canvas
    const canvasListener = onChildAdded(canvasEventsRef, (snapshot) => {
      const data = snapshot.val();
      console.log('[Firebase] 📥 RAW canvas data received:', data);
      console.log('[Firebase] 🔍 Canvas ref available:', !!canvasRef.current);
      console.log('[Firebase] 🔍 Client ID check:', data.clientId, 'vs', clientIdRef.current);
      console.log('[Firebase] 🔍 State data:', !!data.state);
      
      if (data.clientId !== clientIdRef.current && canvasRef.current && data.state) {
        // Imposta flag per prevenire loop infinito
        isApplyingRemoteDataRef.current = true;
        
        // Applica dati al canvas in modo ottimizzato
        try {
          if (fabric && data.state.objects && Array.isArray(data.state.objects)) {
            // Disattiva temporaneamente eventi canvas per prevenire loop
            const originalEvents = canvasRef.current.__eventListeners;
            canvasRef.current.__eventListeners = {};
            
            // Usa requestAnimationFrame per non bloccare il thread principale
            requestAnimationFrame(() => {
              try {
                // Pulisci canvas in modo efficiente
                canvasRef.current.clear();
                
                // Ricostruisci oggetti in batch
                fabric.util.enlivenObjects(data.state.objects).then((objects) => {
                  // Batch aggiunta oggetti per migliorare performance
                  canvasRef.current.renderOnAddRemove = false;
                  
                  objects.forEach((obj: any) => {
                    if (obj) {
                      canvasRef.current.add(obj);
                    }
                  });
                  
                  // Riabilita rendering e forza un solo render
                  canvasRef.current.renderOnAddRemove = true;
                  canvasRef.current.renderAll();
                  
                  // Ripristina eventi dopo un ritardo per permettere completamento
                  setTimeout(() => {
                    canvasRef.current.__eventListeners = originalEvents;
                    isApplyingRemoteDataRef.current = false;
                    console.log(`[Firebase] ✅ Applied ${objects.length} objects, events restored`);
                  }, 100);
                }).catch((error) => {
                  console.error('[Firebase] 💥 Error enlivening objects:', error);
                  canvasRef.current.__eventListeners = originalEvents;
                  isApplyingRemoteDataRef.current = false;
                });
              } catch (error) {
                console.error('[Firebase] 💥 Error in canvas update:', error);
                canvasRef.current.__eventListeners = originalEvents;
                isApplyingRemoteDataRef.current = false;
              }
            });
          } else {
            console.warn('[Firebase] ❌ Invalid fabric module or objects data');
            isApplyingRemoteDataRef.current = false;
          }
        } catch (error) {
          console.error('[Firebase] 💥 Error applying canvas state:', error);
          isApplyingRemoteDataRef.current = false;
        }
      } else {
        console.log('[Firebase] ⏭️ Skipping canvas data - conditions not met');
      }
    });

    // Ascolta eventi journal
    const journalListener = onChildAdded(journalDataRef, (snapshot) => {
      const data = snapshot.val();
      console.log('[Firebase] 📥 RAW journal data received:', data);
      console.log('[Firebase] 🔍 Client ID check:', data.clientId, 'vs', clientIdRef.current);
      console.log('[Firebase] 🔍 Journal sync available:', !!journalSync);
      console.log('[Firebase] 🔍 Journal onAction available:', !!journalSync?.onAction);
      
      if (data.clientId !== clientIdRef.current && journalSync?.onAction) {
        console.log('[Firebase] 🎯 Processing journal action:', data.action);
        try {
          journalSync.onAction(data.action);
          console.log('[Firebase] ✅ Journal action applied successfully');
        } catch (error) {
          console.error('[Firebase] 💥 Error applying journal action:', error);
        }
      } else {
        console.log('[Firebase] ⏭️ Skipping journal data - conditions not met');
      }
    });

    // Ascolta eventi board
    const boardListener = onChildAdded(boardDataRef, (snapshot) => {
      const data = snapshot.val();
      console.log('[Firebase] 📥 RAW board data received:', data);
      console.log('[Firebase] 🔍 Client ID check:', data.clientId, 'vs', clientIdRef.current);
      
      if (data.clientId !== clientIdRef.current && boardSyncHandlers?.onAction) {
        console.log('[Firebase] 🎯 Processing board action:', data.action);
        try {
          boardSyncHandlers.onAction(data.action);
          console.log('[Firebase] ✅ Board action applied successfully');
        } catch (error) {
          console.error('[Firebase] 💥 Error applying board action:', error);
        }
      } else {
        console.log('[Firebase] ⏭️ Skipping board data - conditions not met');
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

  // Disconnetti utente specifico
  const disconnectUser = useCallback((userKey: string) => {
    if (!database || !currentRoomRef.current) {
      console.warn('[Firebase] Cannot disconnect user - not connected');
      return;
    }

    const userRef = ref(database, `rooms/${currentRoomRef.current}/users/${userKey}`);
    remove(userRef)
      .then(() => {
        console.log(`[Firebase] ✅ Disconnected user: ${userKey}`);
      })
      .catch((error) => {
        console.error('[Firebase] ❌ Error disconnecting user:', error);
      });
  }, [database]);

  // Disconnetti tutti gli altri utenti
  const disconnectAllOtherUsers = useCallback(() => {
    if (!database || !currentRoomRef.current) {
      console.warn('[Firebase] Cannot disconnect users - not connected');
      return;
    }

    const usersRef = ref(database, `rooms/${currentRoomRef.current}/users`);
    onValue(usersRef, (snapshot) => {
      const users = snapshot.val() || {};
      
      Object.entries(users).forEach(([key, user]: [string, any]) => {
        // Non disconnettere se stesso
        if (user.clientId !== clientIdRef.current) {
          const userRef = ref(database, `rooms/${currentRoomRef.current}/users/${key}`);
          remove(userRef);
        }
      });
      
      console.log('[Firebase] ✅ Disconnected all other users');
    }, { onlyOnce: true });
  }, [database]);

  // Lascia la stanza
  const leaveRoom = useCallback(() => {
    if (!database || !currentRoomRef.current) {
      return;
    }

    console.log('[Firebase] Leaving room:', currentRoomRef.current);
    
    // Pulisci listeners
    clearListeners();
    
    // Ferma heartbeat
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    
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
    setConnectedUsers(0);
    setIsConnected(false);
  }, [database, clearListeners]);

  // Invia azione journal
  const sendJournalAction = useCallback((action: any) => {
    // BLOCCA COMPLETAMENTE SYNC SE NON CONNESSI
    if (!isConnected) {
      console.log('[Firebase] ⏸️ Journal sync paused - not connected to any room');
      return;
    }
    
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
  }, [database, isConnected]);

  // Invia stato journal
  const sendJournalState = useCallback((state: JournalSyncState) => {
    // BLOCCA COMPLETAMENTE SYNC SE NON CONNESSI
    if (!isConnected) {
      console.log('[Firebase] ⏸️ Journal state sync paused - not connected to any room');
      return;
    }
    
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
  }, [database, isConnected]);

  // Invia stato board
  const sendBoardState = useCallback((state: BoardSyncState) => {
    // BLOCCA COMPLETAMENTE SYNC SE NON CONNESSI
    if (!isConnected) {
      console.log('[Firebase] ⏸️ Board state sync paused - not connected to any room');
      return;
    }
    
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
  }, [database, isConnected]);

  // Invia stato completo canvas
  const sendCanvasFullState = useCallback(() => {
    // Non inviare se stiamo applicando dati remoti per prevenire loop infinito
    if (isApplyingRemoteDataRef.current) {
      console.log('[Firebase] ⏭️ Skipping canvas send - currently applying remote data');
      return;
    }
    
    // BLOCCA COMPLETAMENTE SYNC SE NON CONNESSI
    if (!isConnected) {
      console.log('[Firebase] ⏸️ Sync paused - not connected to any room');
      return;
    }
    
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
          strokeLineCap: obj.strokeLineCap,
          strokeLineJoin: obj.strokeLineJoin,
          strokeDashArray: obj.strokeDashArray,
          opacity: obj.opacity,
          selectable: obj.selectable,
          evented: obj.evented,
          ...(obj.type === 'path' && { path: obj.path }),
          ...(obj.type === 'rect' && { rx: obj.rx, ry: obj.ry }),
          ...(obj.type === 'circle' && { radius: obj.radius }),
          ...(obj.type === 'text' && { 
            text: obj.text,
            fontSize: obj.fontSize,
            fontFamily: obj.fontFamily,
            textAlign: obj.textAlign,
            originX: obj.originX,
            originY: obj.originY
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
  }, [database, canvasRef, isConnected]);

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
    disconnectUser,
    disconnectAllOtherUsers,
    clientIdRef,
    currentRoomRef
  };
}
