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
  connectedUsersList?: any[]; // Nuova prop per lista utenti reali
  currentClientId?: string; // Nuova prop per identificare utente corrente
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
  connectedUsers = 0,
  connectedUsersList = [],
  currentClientId = ''
}: SyncRoomManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [activeTab, setActiveTab] = useState<'join' | 'manage'>('join');
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [allRooms, setAllRooms] = useState<any[]>([]);

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

  // Carica stanze quando si apre il tab gestione
  useEffect(() => {
    if (isOpen && activeTab === 'manage' && allRooms.length === 0) {
      loadRooms();
    }
  }, [isOpen, activeTab]);

  // Formatta data attività
  const formatLastActivity = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'ora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min fa`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} ore fa`;
    return `${Math.floor(diff / 86400000)} giorni fa`;
  };

  // Formatta timestamp connessione
  const formatConnectionTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('it-IT', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Formatta data completa
  const formatFullDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('it-IT', { 
      day: '2-digit',
      month: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit'
    });
  };

  // Ottieni nome display per utente
  const getUserDisplayName = (user: any) => {
    if (user.nickname) return user.nickname;
    if (user.ipAddress) return `PC ${user.ipAddress}`;
    return `Client ${user.clientId?.slice(-8) || 'Unknown'}`;
  };

  // Ordina utenti per tempo di connessione (prima connessi prima)
  const getSortedUsers = () => {
    if (!connectedUsersList || connectedUsersList.length === 0) return [];
    return [...connectedUsersList].sort((a, b) => 
      (a.connectedAt || a.connectedAt || 0) - (b.connectedAt || b.connectedAt || 0)
    );
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
          title={isConnected ? `Disconnetti dalla stanza "${currentRoom}"` : 'Apri pannello sincronizzazione'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: isConnected ? '8px 12px' : '10px 16px',
            fontSize: isConnected ? '12px' : '14px',
            minWidth: isConnected ? 'auto' : '200px',
            justifyContent: 'flex-start'
          }}
        >
          <i className={`fa-solid ${isConnected ? 'fa-unlink' : 'fa-link'}`} />
          {isConnected ? (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'flex-start',
              gap: '2px'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '4px',
                fontWeight: 'bold',
                color: '#28a745',
                fontSize: '11px'
              }}>
                <i className="fa-solid fa-users" style={{ fontSize: '10px' }} />
                {connectedUsers}
              </div>
              <div style={{ 
                color: '#007bff', 
                fontSize: '10px',
                fontWeight: '500',
                maxWidth: '100px',
                overflow: 'hidden', 
                textOverflow: 'ellipsis', 
                whiteSpace: 'nowrap' 
              }}>
                {currentRoom}
              </div>
            </div>
          ) : (
            'Sincronizzazione LAN'
          )}
        </button>

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

              {/* Tab Navigation */}
              <div className="tab-navigation" style={{
                display: 'flex',
                borderBottom: '1px solid #e0e0e0',
                marginBottom: '20px'
              }}>
                <button
                  onClick={() => setActiveTab('join')}
                  className={`tab-button ${activeTab === 'join' ? 'active' : ''}`}
                  style={{
                    flex: 1,
                    padding: '12px',
                    border: 'none',
                    background: activeTab === 'join' ? '#007bff' : '#f8f9fa',
                    color: activeTab === 'join' ? 'white' : '#333',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <i className="fa-solid fa-right-to-bracket" /> Entra nella Stanza
                </button>
                <button
                  onClick={() => setActiveTab('manage')}
                  className={`tab-button ${activeTab === 'manage' ? 'active' : ''}`}
                  style={{
                    flex: 1,
                    padding: '12px',
                    border: 'none',
                    background: activeTab === 'manage' ? '#007bff' : '#f8f9fa',
                    color: activeTab === 'manage' ? 'white' : '#333',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <i className="fa-solid fa-database" /> Gestione Stanze
                  {allRooms.length > 0 && (
                    <span style={{
                      background: '#28a745',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      marginLeft: '8px'
                    }}>
                      {allRooms.length}
                    </span>
                  )}
                </button>
              </div>

              <div className="modal-body">
                {/* Tab Entra nella Stanza */}
                {activeTab === 'join' && (
                  <>
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
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {getSortedUsers().map((user, index) => {
                            const isCurrentUser = user.clientId === currentClientId;
                            const displayName = getUserDisplayName(user);
                            const connectionTime = user.connectedAt || user.connectedAt || Date.now();
                            
                            return (
                              <li 
                                key={user.clientId || user.id || index}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '8px 12px',
                                  marginBottom: '6px',
                                  background: isCurrentUser ? '#e8f4fd' : '#f8f9fa',
                                  borderRadius: '6px',
                                  border: isCurrentUser ? '1px solid #007bff' : '1px solid #e0e0e0'
                                }}
                              >
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 'bold', color: '#333', marginBottom: '2px' }}>
                                    <i className="fa-solid fa-user" style={{ marginRight: '6px', color: isCurrentUser ? '#007bff' : '#6c757d' }} />
                                    {displayName}
                                    {isCurrentUser && (
                                      <span style={{
                                        background: '#007bff',
                                        color: 'white',
                                        padding: '2px 8px',
                                        borderRadius: '12px',
                                        fontSize: '10px',
                                        marginLeft: '8px',
                                        fontWeight: 'normal'
                                      }}>
                                        Tu
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#666', display: 'flex', gap: '15px' }}>
                                    <span>
                                      <i className="fa-solid fa-fingerprint" style={{ marginRight: '4px' }} />
                                      ID: {(user.clientId || user.id || 'unknown').slice(-8)}
                                    </span>
                                    {user.ipAddress && (
                                      <span>
                                        <i className="fa-solid fa-network-wired" style={{ marginRight: '4px' }} />
                                        IP: {user.ipAddress}
                                      </span>
                                    )}
                                    <span>
                                      <i className="fa-solid fa-clock" style={{ marginRight: '4px' }} />
                                      {formatConnectionTime(connectionTime)}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
                                    Connesso: {formatFullDate(connectionTime)}
                                  </div>
                                </div>
                                
                                {!isCurrentUser && onDisconnectUser && (
                                  <button 
                                    onClick={() => {
                                      if (confirm(`Disconnettere ${displayName}?`)) {
                                        onDisconnectUser(user.clientId || user.id);
                                      }
                                    }}
                                    className="btn-small btn-danger"
                                    style={{ 
                                      fontSize: '10px', 
                                      padding: '4px 8px',
                                      background: '#dc3545',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px'
                                    }}
                                    title={`Disconnetti ${displayName}`}
                                  >
                                    <i className="fa-solid fa-times" />
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </>
                )}

                {/* Tab Gestione Stanze */}
                {activeTab === 'manage' && (
                  <>
                    {loadingRooms ? (
                      <div style={{ textAlign: 'center', padding: '40px' }}>
                        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '24px', marginBottom: '15px' }} />
                        <div>Caricamento stanze...</div>
                      </div>
                    ) : allRooms.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                        <i className="fa-solid fa-inbox" style={{ fontSize: '48px', marginBottom: '15px', opacity: 0.5 }} />
                        <div>Nessuna stanza trovata</div>
                        <small>Non ci sono stanze attive su Firebase</small>
                      </div>
                    ) : (
                      <>
                        {/* Header con controlli */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '15px', background: '#f8f9fa', borderRadius: '8px' }}>
                          <div>
                            <h4 style={{ margin: 0, color: '#333' }}>
                              <i className="fa-solid fa-server" /> {allRooms.length} Stanze Trovate
                            </h4>
                            <small style={{ color: '#666' }}>Gestione stanze Firebase</small>
                          </div>
                          <button 
                            onClick={handleDeleteAllRooms}
                            className="btn-small btn-danger"
                            title="Elimina tutte le stanze"
                          >
                            <i className="fa-solid fa-trash-can" /> Elimina Tutte
                          </button>
                        </div>

                        {/* Lista stanze */}
                        <div className="rooms-list" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                          {allRooms.map((room) => (
                            <div 
                              key={room.id}
                              className="room-item"
                              style={{
                                border: '1px solid #e0e0e0',
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: '12px',
                                background: room.id === currentRoom ? '#e8f4fd' : 'white',
                                transition: 'all 0.2s ease'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 'bold', color: '#333', marginBottom: '8px', fontSize: '16px' }}>
                                    <i className="fa-solid fa-door-open" style={{ marginRight: '8px', color: '#007bff' }} />
                                    {room.name}
                                    {room.id === currentRoom && (
                                      <span style={{
                                        background: '#007bff',
                                        color: 'white',
                                        padding: '4px 12px',
                                        borderRadius: '16px',
                                        fontSize: '12px',
                                        marginLeft: '12px',
                                        fontWeight: 'normal'
                                      }}>
                                        <i className="fa-solid fa-check" /> Corrente
                                      </span>
                                    )}
                                  </div>
                                  
                                  <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '14px', color: '#666' }}>
                                    <div>
                                      <i className="fa-solid fa-users" style={{ marginRight: '6px', color: '#28a745' }} />
                                      {room.userCount} utente{room.userCount !== 1 ? 'i' : ''}
                                    </div>
                                    <div>
                                      <i className="fa-solid fa-clock" style={{ marginRight: '6px', color: '#6c757d' }} />
                                      {formatLastActivity(room.lastActivity)}
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', gap: '20px', fontSize: '12px', color: '#888' }}>
                                    <span style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      gap: '6px',
                                      color: room.hasCanvas ? '#28a745' : '#ccc'
                                    }}>
                                      <i className="fa-solid fa-paint-brush" /> Canvas
                                    </span>
                                    <span style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      gap: '6px',
                                      color: room.hasJournal ? '#28a745' : '#ccc'
                                    }}>
                                      <i className="fa-solid fa-book" /> Journal
                                    </span>
                                    <span style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      gap: '6px',
                                      color: room.hasBoard ? '#28a745' : '#ccc'
                                    }}>
                                      <i className="fa-solid fa-chalkboard" /> Board
                                    </span>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '120px' }}>
                                  <button 
                                    onClick={() => onJoinRoom(room.id)}
                                    disabled={room.id === currentRoom}
                                    className="btn-small"
                                    style={{ 
                                      width: '100%',
                                      fontSize: '12px', 
                                      padding: '8px 12px',
                                      opacity: room.id === currentRoom ? 0.5 : 1,
                                      background: room.id === currentRoom ? '#6c757d' : '#007bff',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px'
                                    }}
                                    title={room.id === currentRoom ? 'Sei già in questa stanza' : 'Entra nella stanza'}
                                  >
                                    <i className="fa-solid fa-sign-in-alt" /> Entra
                                  </button>
                                  
                                  {room.id !== currentRoom && (
                                    <button 
                                      onClick={() => handleDeleteRoom(room.id)}
                                      className="btn-small btn-danger"
                                      style={{ 
                                        width: '100%',
                                        fontSize: '12px', 
                                        padding: '8px 12px',
                                        background: '#dc3545',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px'
                                      }}
                                      title="Elimina stanza"
                                    >
                                      <i className="fa-solid fa-trash" /> Elimina
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
