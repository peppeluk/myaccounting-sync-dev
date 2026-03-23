# MyAccounting Sync Development

Sviluppo separato per il sistema di sincronizzazione in tempo reale di MyAccounting Board.

## Caratteristiche

- 🔄 Sincronizzazione multi-client in tempo reale
- 📐 Sincronizzazione sfondo (grid/plain)
- 🎨 Sincronizzazione disegno canvas
- 🚫 Prevenzione loop infiniti di sincronizzazione
- 📡 WebSocket-based real-time communication

## Tecnologie

- React + TypeScript
- Vite
- Fabric.js
- WebSocket
- Supabase (storage)

## Setup

```bash
npm install
npm run dev
```

## Stato Sviluppo

✅ Implementata sincronizzazione canvas base
✅ Implementata sincronizzazione backgroundMode
🚧 Debugging problemi di routing messaggi WebSocket
🚧 Test su ambiente Vercel separato

## Note

Questo è un ambiente di sviluppo isolato per testare la sincronizzazione senza conflitti con il branch principale.
