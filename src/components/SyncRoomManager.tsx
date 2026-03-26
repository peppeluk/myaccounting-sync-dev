import { useState, useEffect } from 'react';

type SyncRoomManagerProps = {
  isConnected: boolean;
  currentRoom: string | null;
  onJoinRoom: (roomId: string, nickname?: string, ipAddress?: string) => void;
  onDisconnectUser?: (userKey: string) => void;
  onDisconnectAll?: () => void;
  onClearRoom?: () => void;
  onGetAllRooms?: () => Promise<any[]>;
  onDeleteRoom?: (roomId: string) => Promise<boolean>;
  onDeleteAllRooms?: () => Promise<boolean>;
  connectedUsers?: number;
};

export function SyncRoomManager({
  isConnected,
  currentRoom,
  onJoinRoom,
  onDisconnectUser,
  onDisconnectAll,
  onClearRoom,
  onGetAllRooms,
  onDeleteRoom,
  onDeleteAllRooms,
  connectedUsers = 0
}: SyncRoomManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [allRooms, setAllRooms] = useState<any[]>([]);
  const [showRoomManager, setShowRoomManager] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(false);

  // Carica nickname salvato
  useEffect(() => {
    const saved = localStorage.getItem('sync-nickname');
    if (saved) setNicknameInput(saved);
  }, []);

  // Carica stanze quando si apre il pannello
  const loadRooms = async () => {
    if (!onGetAllRooms) return;
    
    setLoadingRooms(true);
    try {
      const rooms = await onGetAllRooms();
      setAllRooms(rooms);
    } catch (error) {
      console.error('Error loading rooms:', error);
    } finally {
      setLoadingRooms(false);
    }
  };

  // Formatta data attività
  const formatLastActivity = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'ora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min fa`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ore fa`;
    return `${Math.floor(diff / 86400000)} giorni fa`;
  };

  // Gestione eliminazione stanza
  const handleDeleteRoom = async (roomId: string) => {
    if (!onDeleteRoom) return;
    
    if (confirm(`Eliminare definitivamente la stanza "${roomId}"?\n\nQuesta azione cancellerà tutti i dati della stanza in modo permanente.`)) {
      const success = await onDeleteRoom(roomId);
      if (success) {
        setAllRooms(prev => prev.filter(room => room.id !== roomId));
      }
    }
  };

  // Gestione eliminazione tutte le stanze
  const handleDeleteAllRooms = async () => {
    if (!onDeleteAllRooms) return;
    
    if (confirm('⚠️ ELIMINARE TUTTE LE STANZE?\n\nQuesta azione cancellerà tutte le stanze e tutti i dati in modo permanente.\n\nQuesto processo è IRREVERSIBILE!')) {
      const success = await onDeleteAllRooms();
      if (success) {
        setAllRooms([]);
      }
    }
  };

  const handleJoin = () => {
    if (roomInput.trim()) {
      onJoinRoom(roomInput.trim(), nicknameInput.trim());
      setIsOpen(false);
    }
  };

  return (
    <>
      {/* Bottone Sync */}
      <div className="sync-panel">
        {/* Pulsante sincronizzazione */}
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className={`sync-button ${isConnected ? 'connected' : ''}`}
          title={isConnected ? 'Disconnetti' : 'Apri pannello sincronizzazione'}
        >
          <i className={`fa-solid ${isConnected ? 'fa-unlink' : 'fa-link'}`} />
          {' '}{isConnected ? 'Disconnetti' : 'Sincronizzazione LAN'}
        </button>

        {/* Pulsante gestione stanze */}
        <button 
          onClick={() => {
            setShowRoomManager(!showRoomManager);
            if (!showRoomManager) {
              loadRooms();
            }
          }}
          className="sync-button"
          title="Gestione stanze Firebase"
        >
          <i className="fa-solid fa-database" />
          {' '}Gestione Stanze
        </button>

        {/* Gestione stanze */}
        {showRoomManager && (
          <div className="sync-rooms-manager" style={{
            position: 'absolute',
            top: '100%',
            left: '0',
            right: '0',
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '15px',
            marginTop: '5px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            maxHeight: '400px',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h4 style={{ margin: 0, color: '#333' }}>
                <i className="fa-solid fa-server" /> Stanze Firebase ({allRooms.length})
              </h4>
              <button 
                onClick={() => setShowRoomManager(false)}
                className="btn-small"
                style={{ background: '#f0f0f0', border: 'none', padding: '5px 10px' }}
              >
                <i className="fa-solid fa-times" />
              </button>
            </div>

            {loadingRooms ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <i className="fa-solid fa-spinner fa-spin" /> Caricamento stanze...
              </div>
            ) : allRooms.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                <i className="fa-solid fa-inbox" /> Nessuna stanza trovata
              </div>
            ) : (
              <>
                {/* Pulsante elimina tutte */}
                {allRooms.length > 0 && (
                  <div style={{ marginBottom: '15px', textAlign: 'right' }}>
                    <button 
                      onClick={handleDeleteAllRooms}
                      className="btn-small btn-danger"
                      title="Elimina tutte le stanze"
                    >
                      <i className="fa-solid fa-trash-can" /> Elimina Tutte
                    </button>
                  </div>
                )}

                {/* Lista stanze */}
                <div className="rooms-list">
                  {allRooms.map((room) => (
                    <div 
                      key={room.id}
                      className="room-item"
                      style={{
                        border: '1px solid #e0e0e0',
                        borderRadius: '6px',
                        padding: '12px',
                        marginBottom: '10px',
                        background: room.id === currentRoom ? '#f8f9fa' : 'white'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 'bold', color: '#333', marginBottom: '5px' }}>
                            <i className="fa-solid fa-door-open" /> {room.name}
                            {room.id === currentRoom && (
                              <span style={{
                                background: '#007bff',
                                color: 'white',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                marginLeft: '8px'
                              }}>
                                Corrente
                              </span>
                            )}
                          </div>
                          
                          <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                            <div>
                              <i className="fa-solid fa-users" /> {room.userCount} utente{room.userCount !== 1 ? 'i' : ''}
                            </div>
                            <div>
                              <i className="fa-solid fa-clock" /> {formatLastActivity(room.lastActivity)}
                            </div>
                          </div>

                          <div style={{ fontSize: '11px', color: '#888' }}>
                            <span style={{ marginRight: '15px' }}>
                              <i className={`fa-solid ${room.hasCanvas ? 'fa-paint-brush' : 'fa-paint-brush'}`} 
                                style={{ color: room.hasCanvas ? '#28a745' : '#ccc' }} /> Canvas
                            </span>
                            <span style={{ marginRight: '15px' }}>
                              <i className={`fa-solid ${room.hasJournal ? 'fa-book' : 'fa-book'}`} 
                                style={{ color: room.hasJournal ? '#28a745' : '#ccc' }} /> Journal
                            </span>
                            <span>
                              <i className={`fa-solid ${room.hasBoard ? 'fa-chalkboard' : 'fa-chalkboard'}`} 
                                style={{ color: room.hasBoard ? '#28a745' : '#ccc' }} /> Board
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          <button 
                            onClick={() => onJoinRoom(room.id)}
                            disabled={room.id === currentRoom}
                            className="btn-small"
                            style={{ 
                              fontSize: '10px', 
                              padding: '4px 8px',
                              opacity: room.id === currentRoom ? 0.5 : 1
                            }}
                            title={room.id === currentRoom ? 'Sei già in questa stanza' : 'Entra nella stanza'}
                          >
                            <i className="fa-solid fa-sign-in-alt" />
                          </button>
                          
                          {room.id !== currentRoom && (
                            <button 
                              onClick={() => handleDeleteRoom(room.id)}
                              className="btn-small btn-danger"
                              style={{ fontSize: '10px', padding: '4px 8px' }}
                              title="Elimina stanza"
                            >
                              <i className="fa-solid fa-trash" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Pannello sincronizzazione */}
        {isOpen && (
          <div className="modal-overlay" onClick={() => setIsOpen(false)}>
            <div className="modal-content sync-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>
                  <i className="fa-solid fa-share-nodes" />
                  Sincronizzazione LAN
                </h2>
                <button onClick={() => setIsOpen(false)} className="icon-button">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>

              <div className="modal-body">
                <div className="form-group">
                  <label>
                    <i className="fa-solid fa-door-open" />
                    Nome stanza
                  </label>
                  <input
                    type="text"
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value)}
                    placeholder="Es: aula-1a, aula-3c"
                    className="form-input"
                  />
                  <small className="form-hint">
                    Scegli un nome univoco per la tua stanza di lavoro
                  </small>
                </div>

                <div className="form-group">
                  <label>
                    <i className="fa-solid fa-user" />
                    Nome dispositivo (opzionale)
                  </label>
                  <input
                    type="text"
                    value={nicknameInput}
                    onChange={(e) => {
                      setNicknameInput(e.target.value);
                      localStorage.setItem('sync-nickname', e.target.value);
                    }}
                    placeholder="Il tuo nome"
                    className="form-input"
                  />
                  <small className="form-hint">
                    Tutti i dispositivi nella stessa stanza si sincronizzano
                  </small>
                </div>

                <button onClick={handleJoin} className="btn-primary btn-block">
                  <i className="fa-solid fa-right-to-bracket" />
                  Entra nella stanza
                </button>

                {isConnected && (
                  <div className="sync-status">
                    <div className="sync-indicator">
                      <div className="sync-dot active"></div>
                      <span>Connesso a: {currentRoom}</span>
                    </div>
                    <div className="sync-users">
                      <i className="fa-solid fa-users" />
                      Dispositivi connessi: {connectedUsers}
                    </div>
                  </div>
                )}

                {connectedUsers > 0 && (
                  <div className="sync-connected-users">
                    <h4>
                      <i className="fa-solid fa-users" />
                      Dispositivi connessi ({connectedUsers})
                      {connectedUsers > 1 && onDisconnectAll && (
                        <button 
                          onClick={() => {
                            if (confirm('Disconnettere tutti gli altri utenti?')) {
                              onDisconnectAll();
                            }
                          }}
                          className="btn-small btn-danger"
                          style={{ marginLeft: '10px', fontSize: '11px' }}
                          title="Disconnetti tutti gli altri utenti"
                        >
                          <i className="fa-solid fa-user-slash" />
                        </button>
                      )}
                      {onClearRoom && (
                        <button 
                          onClick={() => {
                            if (confirm('⚠️ SVUOTARE COMPLETAMENTE LA STANZA?\n\nQuesta azione cancellerà:\n• Tutti gli utenti connessi\n• Tutti i disegni salvati\n• Tutte le note del journal\n• Tutti i dati della board\n\nQuesto processo è IRREVERSIBILE!')) {
                              onClearRoom();
                            }
                          }}
                          className="btn-small btn-warning"
                          style={{ marginLeft: '10px', fontSize: '11px' }}
                          title="Svuota completamente la stanza"
                        >
                          <i className="fa-solid fa-trash-can" />
                        </button>
                      )}
                    </h4>
                    <ul>
                      {Array.from({ length: connectedUsers }, (_, i) => (
                        <li key={i}>
                          Utente {i + 1}
                          {i > 0 && onDisconnectUser && (
                            <button 
                              onClick={() => {
                                if (confirm(`Disconnettere Utente ${i + 1}?`)) {
                                  onDisconnectUser(`user-${i}`);
                                }
                              }}
                              className="btn-small btn-danger"
                              style={{ marginLeft: '10px', fontSize: '10px' }}
                              title={`Disconnetti Utente ${i + 1}`}
                            >
                              <i className="fa-solid fa-times" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
