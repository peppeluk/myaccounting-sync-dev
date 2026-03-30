import { useCallback, useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { 
  getDatabase, 
  ref, 
  onValue, 
  onDisconnect, 
  set, 
  remove, 
  serverTimestamp,
  Database 
} from 'firebase/database';

interface CanvasState {
  objects: any[];
  background?: string;
  version?: number;
}

interface FirebaseUser {
  clientId: string;
  lastSeen: number;
  isOnline: boolean;
}

interface JournalEntry {
  id: string;
  type: 'add' | 'modify' | 'remove' | 'clear';
  timestamp: number;
  data: any;
  clientId: string;
}

export type JournalSyncState = {
  entries: any[];
  selectedProfileId?: string;
  isJournalOpen?: boolean;
  isCalculatorOpen?: boolean;
  calculatorDisplay?: string;
};

export type BoardSyncState = {
  isConnected: boolean;
  currentRoom: string | null;
  connectedUsers: number;
};

export type BoardSyncHandlers = {
  sendBoardState: (state: any) => void;
  sendJournalState: (state: any) => void;
  sendJournalAction: (action: any) => void;
  sendCanvasFullState: (state: any) => void;
  disconnectUser: (clientId: string) => void;
  disconnectAllOtherUsers: () => void;
};

const firebaseConfig = {
  apiKey: "AIzaSyC6u5p5A6y3LqJ9n8m4o2p1r9s8t7u6v5w",
  authDomain: "myaccounting-sync-dev.firebaseapp.com",
  databaseURL: "https://myaccounting-sync-dev-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "myaccounting-sync-dev",
  storageBucket: "myaccounting-sync-dev.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456789012345678"
};

let database: Database | null = null;
let firebaseInitialized = false;

const initializeFirebase = (): boolean => {
  if (firebaseInitialized && database) {
    return true;
  }

  try {
    // Importa dinamicamente Firebase solo quando necessario
    import('firebase/app').then((firebaseApp) => {
      import('firebase/database').then(() => {
        if (!firebaseApp.getApps().length) {
          firebaseApp.initializeApp(firebaseConfig);
        }
        database = getDatabase();
        firebaseInitialized = true;
        console.log('[Firebase] ✅ Firebase initialized successfully');
      });
    });
    return true;
  } catch (error) {
    console.error('[Firebase] ❌ Failed to initialize Firebase:', error);
    return false;
  }
};

export const useCanvasSyncFirebase = (
  canvasRef: React.MutableRefObject<fabric.Canvas | null>,
  roomId: string
) => {
  const [isConnected, setIsConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [connectedUsers, setConnectedUsers] = useState(0);
  const [connectedUsersList, setConnectedUsersList] = useState<any[]>([]);
  
  const clientIdRef = useRef<string>('');
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isJoiningRef = useRef<boolean>(false);
  const isReconstructingRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastReconstructTimeRef = useRef<number>(0);
  
  // 🚨 LISTENER MANAGEMENT
  const unsubUsersRef = useRef<(() => void) | null>(null);
  const unsubCanvasStatesRef = useRef<(() => void) | null>(null);
  const unsubJournalRef = useRef<(() => void) | null>(null);
  const unsubJournalStateRef = useRef<(() => void) | null>(null);
  const unsubBoardStateRef = useRef<(() => void) | null>(null);
  const unsubBoardRef = useRef<(() => void) | null>(null);
  
  // 🚨 DEBUG COUNTER
  let listenerCount = 0;

  // Genera ID client univoco
  const generateClientId = useCallback(() => {
    if (!clientIdRef.current) {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substr(2, 9);
      const extraRandom = Math.random().toString(36).substr(2, 5);
      
      // Controlla se crypto è disponibile per maggiore sicurezza
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const array = new Uint32Array(1);
        crypto.getRandomValues(array);
        clientIdRef.current = `client-${timestamp}-${array[0]}-${extraRandom}`;
      } else {
        // Fallback a timestamp più preciso
        clientIdRef.current = `client-${timestamp}-${random}-${extraRandom}`;
      }
    }
  }, []);

  // Flag per prevenire loop infinito di sincronizzazione
  const isApplyingRemoteDataRef = useRef<boolean>(false);
  const currentRoomRef = useRef<string | null>(null);
  const listenersRef = useRef<any[]>([]);

  // Pulisci listeners quando cambia stanza
  const clearListeners = useCallback(() => {
    console.log('[Firebase] 🧹 Clearing all listeners...');
    
    // CLEANUP DEBOUNCE TIMER
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      console.log('[Firebase] 🧹 Cleared debounce timer');
    }
    
    // RESET MUTEX E TIMERS
    isReconstructingRef.current = false;
    lastReconstructTimeRef.current = 0;
    console.log('[Firebase] 🧹 Reset reconstruction mutex and timer');
    
    listenersRef.current.forEach(unsub => {
      if (typeof unsub === 'function') {
        unsub();
      }
    });
    listenersRef.current = [];
    
    // CLEANUP UNSUB REFS
    if (unsubUsersRef.current) {
      unsubUsersRef.current();
      unsubUsersRef.current = null;
    }
    if (unsubCanvasStatesRef.current) {
      unsubCanvasStatesRef.current();
      unsubCanvasStatesRef.current = null;
    }
    if (unsubJournalRef.current) {
      unsubJournalRef.current();
      unsubJournalRef.current = null;
    }
    if (unsubJournalStateRef.current) {
      unsubJournalStateRef.current();
      unsubJournalStateRef.current = null;
    }
    if (unsubBoardStateRef.current) {
      unsubBoardStateRef.current();
      unsubBoardStateRef.current = null;
    }
    if (unsubBoardRef.current) {
      unsubBoardRef.current();
      unsubBoardRef.current = null;
    }
    
    console.log('[Firebase] ✅ All listeners cleared');
  }, []);

  // Unisciti alla stanza
  const joinRoom = useCallback((roomId: string) => {
    if (isJoiningRef.current) {
      console.log('[Firebase] Already joining - skipping duplicate join');
      return;
    }
    
    if (!initializeFirebase()) {
      console.warn('[Firebase] Cannot join room - Firebase initialization failed');
      return;
    }

    console.log('[Firebase] Joining room:', roomId);
    isJoiningRef.current = true;
    currentRoomRef.current = roomId;
    setCurrentRoom(roomId);
    setIsConnected(true);

    // Pulisci listeners precedenti
    clearListeners();

    // Genera ID client se non esiste
    generateClientId();

    // Riferimenti Firebase
    if (!database) {
      console.error('[Firebase] Database not initialized');
      return;
    }
    
    const usersRef = ref(database, `rooms/${roomId}/users`);
    const canvasStatesRef = ref(database, `rooms/${roomId}/canvasStates`);
    const journalRef = ref(database, `rooms/${roomId}/journal`);

    // 🚨 USERS LISTENER CON UNSUBSCRIBE
    if (unsubUsersRef.current) unsubUsersRef.current();
    
    console.log('[LISTENER COUNT] users listeners registered:', ++listenerCount);
    
    unsubUsersRef.current = onValue(usersRef, (snapshot) => {
      const users = snapshot.val() || {};
      const activeUsers = Object.values(users).filter((user: any) => 
        user && user.isOnline && Date.now() - user.lastSeen < 30000
      );
      
      setConnectedUsers(activeUsers.length);
      setConnectedUsersList(activeUsers);
      
      console.log('[Firebase] 👥 Active users:', activeUsers.length);
    });

    // 🚨 CANVAS STATES LISTENER CON UNSUBSCRIBE - SENZA LISTENER ANNIDATO
    if (unsubCanvasStatesRef.current) unsubCanvasStatesRef.current();
    
    console.log('[LISTENER COUNT] canvasStates listeners registered:', ++listenerCount);
    console.log('🔧🔧🔧 CREATING CANVAS STATE LISTENER... 🔧🔧🔧');
    
    unsubCanvasStatesRef.current = onValue(canvasStatesRef, (snapshot) => {
      console.log('🚨🚨🚨 CANVAS STATES LISTENER TRIGGERED! 🚨🚨🚨');
      const allStates = snapshot.val();
      if (!allStates) return;
      
      // 🚨 FILTRA SOLO CLIENT ATTIVI - usa stato invece di nuovo listener
      const activeUsers = connectedUsersList || [];
      const activeClientIds = activeUsers.map((user: any) => user.clientId);
      
      console.log('[Firebase] 👥 Active client IDs:', activeClientIds);
      console.log('[Firebase] 📥 All canvas states:', Object.keys(allStates));

      // Trova lo stato più recente tra i client attivi
      let mostRecentState: { clientId: string; state: any } | null = null;
      let mostRecentTime = 0;

      Object.entries(allStates).forEach(([clientId, state]: [string, any]) => {
        if (activeClientIds.includes(clientId) && state && state.timestamp) {
          if (state.timestamp > mostRecentTime) {
            mostRecentTime = state.timestamp;
            mostRecentState = { clientId, state };
          }
        }
      });

      console.log('[Firebase] 🕐 Most recent state available');

      // Applica lo stato più recente se non è del client corrente
      if (mostRecentState && mostRecentState.clientId !== clientIdRef.current) {
        console.log('[Firebase] 🚨 RECONSTRUCTION DISABLED - preventing timeout cascade');
        return; // 🚨 BLOCCO COMPLETO - nessuna ricostruzione
      }
    });

    // 🚨 JOURNAL LISTENER CON UNSUBSCRIBE
    if (unsubJournalRef.current) unsubJournalRef.current();
    
    console.log('[LISTENER COUNT] journal listeners registered:', ++listenerCount);
    
    unsubJournalRef.current = onValue(journalRef, (snapshot) => {
      const journal = snapshot.val() || {};
      console.log('[Firebase] 📚 Loading existing journal entries:', Object.keys(journal).length);
    }, { onlyOnce: true });

    // Registra presenza utente
    const userRef = ref(database, `rooms/${roomId}/users/${clientIdRef.current}`);
    set(userRef, {
      clientId: clientIdRef.current,
      lastSeen: serverTimestamp(),
      isOnline: true
    });

    // Imposta disconnessione automatica
    onDisconnect(userRef).update({
      isOnline: false,
      lastSeen: serverTimestamp()
    });

    // Heartbeat per mantenere presenza
    const heartbeat = () => {
      set(userRef, {
        clientId: clientIdRef.current,
        lastSeen: serverTimestamp(),
        isOnline: true
      });
    };

    heartbeatIntervalRef.current = setInterval(heartbeat, 10000);

    isJoiningRef.current = false;
    console.log('[Firebase] ✅ Successfully joined room:', roomId);
  }, [clearListeners, generateClientId, connectedUsersList]);

  // Lascia la stanza
  const leaveRoom = useCallback(() => {
    console.log('[Firebase] Leaving room...');
    
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    if (database && currentRoomRef.current && clientIdRef.current) {
      const userRef = ref(database!, `rooms/${currentRoomRef.current}/users/${clientIdRef.current}`);
      remove(userRef);
    }

    clearListeners();
    currentRoomRef.current = null;
    setCurrentRoom(null);
    setIsConnected(false);
    setConnectedUsers(0);
    setConnectedUsersList([]);
  }, [clearListeners]);

  // Salva stato canvas
  const saveCanvasState = useCallback(() => {
    if (!canvasRef.current || !database || !currentRoomRef.current || isApplyingRemoteDataRef.current) {
      return;
    }

    try {
      const canvasState = canvasRef.current.toJSON();
      const stateRef = ref(database, `rooms/${currentRoomRef.current}/canvasStates/${clientIdRef.current}`);
      
      set(stateRef, {
        state: canvasState,
        timestamp: Date.now()
      });

      console.log('[Firebase] 💾 Canvas state saved');
    } catch (error) {
      console.error('[Firebase] Error saving canvas state:', error);
    }
  }, []);

  // Pulisci all'unmount
  useEffect(() => {
    return () => {
      leaveRoom();
    };
  }, [leaveRoom]);

  return {
    isConnected,
    currentRoom,
    connectedUsers,
    connectedUsersList,
    joinRoom,
    leaveRoom,
    saveCanvasState,
    // Funzioni aggiuntive per compatibilità App.tsx
    clearRoom: () => {
      if (canvasRef.current) {
        canvasRef.current.clear();
      }
    },
    getAllRooms: async () => [],
    deleteRoom: async () => false,
    deleteAllRooms: async () => false,
    sendJournalAction: (action: any) => {},
    sendJournalState: (state: any) => {},
    sendBoardState: (state: any) => {},
    sendCanvasFullState: (state: any) => {},
    disconnectUser: (clientId: string) => {},
    disconnectAllOtherUsers: () => {},
    // Ref per compatibilità
    currentRoomRef,
    clientIdRef
  };
};
