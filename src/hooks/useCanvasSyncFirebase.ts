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
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || process.env.REACT_APP_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || process.env.REACT_APP_FIREBASE_APP_ID
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
  const isProcessingRef = useRef<boolean>(false); // 🚨 Blocca esecuzioni multiple
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastReconstructTimeRef = useRef<number>(0);
  const lastProcessedStateRef = useRef<any>(null); // 🚨 Track last processed state
  
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
  const lastRemoteApplyTimeRef = useRef<number>(0); // ** Traccia ultimo apply remoto
  const currentRoomRef = useRef<string | null>(null);
  const globalStateKeyRef = useRef<string>(''); // ** BLOCCO GLOBALE per prevenire applicazioni simultanee
  const globalProcessingHashRef = useRef<string>(''); // ** BLOCCO HASH per prevenire applicazioni duplicate
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
      console.log('[Firebase] **DEBUG: Raw users data from Firebase:', users);
      
      const activeUsers = Object.values(users).filter((user: any) => 
        user && user.isOnline && Date.now() - user.lastSeen < 30000
      );
      
      console.log('[Firebase] **DEBUG: Active users filtered:', activeUsers);
      console.log('[Firebase] **DEBUG: Active users clientId check:', activeUsers.map(u => ({ 
        clientId: u?.clientId, 
        isOnline: u?.isOnline, 
        lastSeen: u?.lastSeen 
      })));
      
      setConnectedUsers(activeUsers.length);
      setConnectedUsersList(activeUsers);
      
      console.log('[Firebase] **DEBUG: Connected users list set:', activeUsers.length);
      console.log('[Firebase] **DEBUG: Connected users list content:', connectedUsersList);
    });

    // 🚨 CANVAS STATES LISTENER CON UNSUBSCRIBE - SENZA LISTENER ANNIDATO
    if (unsubCanvasStatesRef.current) unsubCanvasStatesRef.current();
    
    console.log('[LISTENER COUNT] canvasStates listeners registered:', ++listenerCount);
    console.log('🔧🔧🔧 CREATING CANVAS STATE LISTENER... 🔧🔧🔧');
    
    unsubCanvasStatesRef.current = onValue(canvasStatesRef, (snapshot) => {
      console.log('Firebase Listener Triggered');
      
      // **BLOCCO IMMEDIATO HASH GLOBALE** - previene TUTTI i loop infiniti PRIMA di qualsiasi elaborazione
      const allStates = snapshot.val();
      if (!allStates) return;
      
      // Calcola hash completo di tutti gli stati
      const globalHash = JSON.stringify(allStates);
      if (globalStateKeyRef.current === globalHash) {
        console.log('[Firebase] **GLOBAL HASH BLOCK: Same global state - COMPLETELY BLOCKING');
        return;
      }
      
      // **SICUREZZA: Reset isApplyingRemoteDataRef se bloccato da troppo tempo**
      if (isApplyingRemoteDataRef.current) {
        const timeSinceLastRemoteApply = Date.now() - (lastRemoteApplyTimeRef.current || 0);
        console.log('[Firebase] **SAFETY CHECK: isApplyingRemoteDataRef stuck for', timeSinceLastRemoteApply, 'ms');
        if (timeSinceLastRemoteApply > 3000) { // 3 secondi invece di 5
          console.warn('[Firebase] **SAFETY RESET: Forcing isApplyingRemoteDataRef to false');
          isApplyingRemoteDataRef.current = false;
        }
      }
      
      // Imposta blocco hash globale immediatamente
      globalStateKeyRef.current = globalHash;
      console.log('[Firebase] **GLOBAL HASH BLOCK SET for new state');
      
      // **BLOCCO FREQUENZA** - max 1 chiamata ogni 2 secondi
      const now = Date.now();
      if (now - lastReconstructTimeRef.current < 2000) {
        console.log('[Firebase] **FREQUENCY BLOCK: Too many Firebase calls - IGNORING');
        return;
      }
      lastReconstructTimeRef.current = now;
      
      console.log('[Firebase] **PASSED ALL BLOCKS - Processing new state...');
      
      // 🚨 BLOCCO GLOBALE IMMEDIATO - previene esecuzioni multiple dello stesso snapshot
      const snapshotKey = JSON.stringify(allStates);
      if (globalStateKeyRef.current === snapshotKey) {
        console.log('[Firebase] 🚫 GLOBAL SNAPSHOT BLOCK: Same snapshot already processing - SKIPPING');
        return;
      }
      globalStateKeyRef.current = snapshotKey;
      console.log('[Firebase] 🔒 GLOBAL SNAPSHOT BLOCK SET for snapshot hash');
      
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

      console.log('[Firebase] Most recent state available');

      // Applica lo stato più recente se non è del client corrente
      if (mostRecentState && mostRecentState.clientId !== clientIdRef.current) {
        // BLOCCO HASH UNIVERSALE - previene applicazioni duplicate in assoluto
        const stateHash = `${mostRecentState.clientId}-${mostRecentState.state?.timestamp || 0}-${mostRecentState.state?.objects?.length || 0}`;
        if (globalProcessingHashRef.current === stateHash) {
          console.log('[Firebase] **HASH BLOCK: Same state already processed globally - BLOCKING');
          console.log('[Firebase] **Hash:', stateHash);
          return;
        }
        
        // Imposta blocco hash immediatamente
        globalProcessingHashRef.current = stateHash;
        console.log('[Firebase] **HASH BLOCK SET for state:', stateHash);
        
        // BLOCCO IMMEDIATO - previene esecuzioni multiple
        if (isProcessingRef.current) {
          console.log('[Firebase] **PROCESSING BLOCK: Already processing - BLOCKING');
          globalProcessingHashRef.current = ''; // Reset per permettere altri stati
          return;
        }
        
        // Controlla se stiamo già processando o se è passato troppo poco tempo dall'ultimo sync
        const now = Date.now();
        if (now - lastReconstructTimeRef.current < 500) {
          console.log('[Firebase] **THROTTLE BLOCK: Too soon since last reconstruction - BLOCKING');
          isProcessingRef.current = false; // RESET FLAG
          globalProcessingHashRef.current = ''; // Reset per permettere altri stati
          return;
        }
        
        // IMPOSTA FLAG PROCESSING IMMEDIATAMENTE
        isProcessingRef.current = true;
        console.log('[Firebase] **PROCESSING FLAG SET');
        
        // PREVENI RICOSTRUZIONI DUPLICATE - controlla se abbiamo già processato questo stato
        const stateKey = `${mostRecentState.clientId}-${mostRecentState.state?.timestamp || 'no-timestamp'}-${mostRecentState.state?.objects?.length || 0}`;
        console.log('[Firebase] **State key:', stateKey);
        console.log('[Firebase] **Last processed state:', lastProcessedStateRef.current);
        
        if (lastProcessedStateRef.current === stateKey) {
          console.log('[Firebase] **DUPLICATE BLOCK: State already processed - BLOCKING');
          isProcessingRef.current = false; // RESET FLAG
          globalProcessingHashRef.current = ''; // Reset per permettere altri stati
          return;
        }
        
        // Aggiorna timestamp dell'ultima ricostruzione
        lastReconstructTimeRef.current = now;
        console.log('[Firebase] 🔍 State data:', !!mostRecentState.state);
        console.log('[Firebase] 🔍 State objects:', mostRecentState.state?.objects?.length);
        console.log('[Firebase] 🔍 Fabric available:', !!fabric);
        console.log('[Firebase] 🔍 State key:', stateKey);
        
        // 🚨 CONTROLLO COMPLETO - previene ricostruzioni non necessarie
        if (!canvasRef.current || !mostRecentState.state || !fabric) {
          console.log('[Firebase] ⚠️ Missing required data for reconstruction, skipping');
          return;
        }
        
        console.log('[Firebase] 🔍 COMPLETE CANVAS STATE ANALYSIS:');
        console.log('   - mostRecentState.clientId:', mostRecentState.clientId);
        console.log('   - clientIdRef.current:', clientIdRef.current);
        console.log('   - mostRecentState.clientId === clientIdRef.current:', mostRecentState.clientId === clientIdRef.current);
        console.log('   - mostRecentState.clientId !== clientIdRef.current:', mostRecentState.clientId !== clientIdRef.current);
        
        // 🚨 CRITICAL: Previeni loop infinito - non applicare mai il proprio stato
        if (mostRecentState.clientId === clientIdRef.current) {
          console.log('[Firebase] 🚫 CRITICAL: Skipping own state to prevent infinite loop!');
          console.log('[Firebase] 🚫 This client would apply its own state as "remote" - BLOCKED');
          isProcessingRef.current = false;
          return;
        }

        // 🚨 BLOCCO GLOBALE: Previene applicazioni simultanee dello stesso stato
        const currentStateKey = `${mostRecentState.clientId}-${mostRecentState.state?.timestamp || 0}-${mostRecentState.state?.objects?.length || 0}`;
        if (globalStateKeyRef.current === currentStateKey) {
          console.log('[Firebase] 🚫 GLOBAL BLOCK: Same state already being applied elsewhere - SKIPPING');
          console.log('[Firebase] 🚫 State key:', currentStateKey);
          isProcessingRef.current = false;
          return;
        }
        
        // Imposta il blocco globale
        globalStateKeyRef.current = currentStateKey;
        console.log('[Firebase] 🔒 GLOBAL BLOCK SET for state:', currentStateKey);
        
        // 🚨 CONDIZIONI STRETTE - solo se tutte soddisfatte
        if (mostRecentState.clientId !== clientIdRef.current && canvasRef.current && mostRecentState.state && mostRecentState.state.objects && Array.isArray(mostRecentState.state.objects)) {
          console.log('[Firebase] 🎯 Conditions met - applying remote canvas state');
          console.log('[Firebase] 🎨 Starting canvas reconstruction with', mostRecentState.state.objects.length, 'objects');
          
          // Imposta flag per prevenire loop infinito
          isApplyingRemoteDataRef.current = true;
          lastRemoteApplyTimeRef.current = Date.now(); // ** Traccia tempo apply remoto
          
          // Applica dati al canvas in modo ottimizzato
          try {
            // Disattiva temporaneamente eventi canvas per prevenire loop
            const originalEvents = canvasRef.current.__eventListeners;
            canvasRef.current.__eventListeners = {};
            
            // Usa requestAnimationFrame per non bloccare il thread principale
            requestAnimationFrame(() => {
              try {
                // Pulisci canvas in modo efficiente
                canvasRef.current.clear();
                
                // Ricostruisci oggetti con logica migliorata
                const reconstructObjects = async (objectsData: any[]): Promise<any[]> => {
                  console.log('[Firebase] 🔧 RECONSTRUCT OBJECTS CALLED with', objectsData.length, 'objects');
                  console.log('[Firebase] 🔍 Objects types:', objectsData.map(obj => obj.type));
                  
                  // 🚨 DEBOUNCE - cancella timer precedente
                  if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                    console.log('[Firebase] ⏭️ Cleared previous debounce timer');
                  }
                  
                  // 🚨 MUTEX - previene ricostruzioni concorrenti
                  if (isReconstructingRef.current) {
                    console.log('[Firebase] ⏭️ Reconstruction already in progress, skipping');
                    return [];
                  }
                  isReconstructingRef.current = true;
                  
                  try {
                    // 🚨 TIMEOUT CON CANCELLAZIONE - usa Promise.race con timeout cancellabile
                    const timeoutId = setTimeout(() => {
                      console.warn('[Firebase] ⏰ Reconstruction timeout reached');
                    }, 5000); // 5 secondi timeout
                    
                    const result = await Promise.race([
                      fabric.util.enlivenObjects(objectsData),
                      new Promise<any[]>((resolve) => 
                        setTimeout(() => {
                          console.warn('[Firebase] ⏰ enlivenObjects timeout (10s) - using fallback');
                          resolve([]);
                        }, 10000) // 10 secondi invece di 5
                      )
                    ]);
                    
                    console.log('[Firebase] ✅ enlivenObjects completed with', result.length, 'objects');
                    return result;
                  } catch (error) {
                    console.error('[Firebase] Error enlivening objects:', error);
                    return [];
                  } finally {
                    // 🚨 RESET MUTEX - sempre eseguito sia successo che errore
                    isReconstructingRef.current = false;
                  }
                };
                
                // Ricostruisci e applica oggetti
                reconstructObjects(mostRecentState.state.objects).then((reconstructed) => {
                  console.log('[Firebase] 🎯 Reconstructed', reconstructed.length, 'objects, applying to canvas');
                  console.log('[Firebase] 🔍 Objects to apply:', reconstructed);
                  
                  // Applica oggetti al canvas
                  reconstructed.forEach((obj, index) => {
                    try {
                      canvasRef.current.add(obj);
                      console.log('[Firebase] ✅ Object', index, 'added successfully');
                    } catch (error) {
                      console.error('[Firebase] Error adding object', index, ':', error);
                    }
                  });
                  
                  console.log('[Firebase] 🔄 Object application loop completed');
                  
                  // Riabilita eventi e rendering
                  canvasRef.current.__eventListeners = originalEvents;
                  canvasRef.current.renderAll();
                  console.log('[Firebase] ✅ renderAll() completed');
                  
                  // **RESET COMPLETO DI TUTTI I BLOCCHI** - previene client bloccati
                  globalStateKeyRef.current = '';
                  globalProcessingHashRef.current = '';
                  isProcessingRef.current = false;
                  isApplyingRemoteDataRef.current = false; // **IMPORTANTE: Reset anche questo flag**
                  console.log('[Firebase] **ALL BLOCKS RESET - All clients can now save/transmit');
                });
                
              } catch (error) {
                console.error('[Firebase] 💥 Error in requestAnimationFrame:', error);
                // Ripristina eventi anche in caso di errore
                canvasRef.current.__eventListeners = originalEvents;
                isApplyingRemoteDataRef.current = false;
              }
            });
          } catch (error) {
            console.error('[Firebase] Error applying remote canvas state:', error);
            isApplyingRemoteDataRef.current = false;
          }
        } else {
          console.log('[Firebase] ⏸️ Conditions not met for reconstruction, skipping');
        }
      } else {
          console.log('[Firebase] ⏸️ No remote state to apply or is current client state');
        }
        
        // 🚨 RESET BLOCCO SNAPSHOT - permette nuovi snapshot
        globalStateKeyRef.current = '';
        console.log('[Firebase] 🔓 GLOBAL SNAPSHOT BLOCK RESET - new snapshots allowed');
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
    const userData = {
      clientId: clientIdRef.current,
      lastSeen: serverTimestamp(),
      isOnline: true
    };
    
    console.log('[Firebase] **DEBUG: Saving user data to Firebase:');
    console.log('  - User path:', `rooms/${roomId}/users/${clientIdRef.current}`);
    console.log('  - User data:', userData);
    console.log('  - clientIdRef.current:', clientIdRef.current);
    
    set(userRef, userData);

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
    console.log('[Firebase] 💾 saveCanvasState called on client:', clientIdRef.current);
    console.log('[Firebase] 🔍 Canvas ref:', !!canvasRef.current);
    console.log('[Firebase] 🔍 Database:', !!database);
    console.log('[Firebase] 🔍 Current room:', !!currentRoomRef.current);
    console.log('[Firebase] 🔍 isApplyingRemoteDataRef:', isApplyingRemoteDataRef.current);
    console.log('[Firebase] 🔍 Canvas objects count:', canvasRef.current?.getObjects()?.length || 0);
    
    // ** CONTROLLO DI SICUREZZA - resetta flag se bloccato per più di 5 secondi
    if (isApplyingRemoteDataRef.current) {
      const timeSinceLastRemoteApply = Date.now() - (lastRemoteApplyTimeRef.current || 0);
      console.log('[Firebase] ⏱️ Time since last remote apply:', timeSinceLastRemoteApply, 'ms');
      if (timeSinceLastRemoteApply > 5000) {
        console.warn('[Firebase] ⚠️ saveCanvasState: isApplyingRemoteDataRef stuck for', timeSinceLastRemoteApply, 'ms - forcing reset');
        isApplyingRemoteDataRef.current = false;
      } else {
        console.log('[Firebase] ❌ saveCanvasState blocked - currently applying remote data');
        return;
      }
    }
    
    if (!canvasRef.current || !database || !currentRoomRef.current) {
      console.log('[Firebase] ❌ saveCanvasState blocked - missing requirements');
      console.log('   - canvasRef.current:', !!canvasRef.current);
      console.log('   - database:', !!database);
      console.log('   - currentRoomRef.current:', !!currentRoomRef.current);
      return;
    }

    try {
      const canvasState = canvasRef.current.toJSON();
      const stateRef = ref(database, `rooms/${currentRoomRef.current}/canvasStates/${clientIdRef.current}`);
      
      console.log('[Firebase] 📤 About to save state for client:', clientIdRef.current);
      console.log('[Firebase] 📤 Firebase path:', `rooms/${currentRoomRef.current}/canvasStates/${clientIdRef.current}`);
      console.log('[Firebase] 📤 Canvas objects being saved:', canvasState.objects?.length || 0);
      
      set(stateRef, {
        state: canvasState,
        timestamp: Date.now()
      });

      console.log('[Firebase] ✅ Canvas state saved successfully for client:', clientIdRef.current);
    } catch (error) {
      console.error('[Firebase] ❌ Error saving canvas state:', error);
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
    sendCanvasFullState: () => {
      console.log('[Firebase] sendCanvasFullState called');
      saveCanvasState();
    },
    disconnectUser: (clientId: string) => {},
    disconnectAllOtherUsers: () => {},
    // Ref per compatibilità
    currentRoomRef,
    clientIdRef,
    isApplyingRemoteDataRef,
    lastRemoteApplyTimeRef // ** Espongo tracking tempo remoto
  };
};
