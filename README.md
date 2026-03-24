# MyAccounting Sync Development

Sviluppo separato per il sistema di sincronizzazione in tempo reale di MyAccounting Board.

## Caratteristiche

- 🔄 Sincronizzazione multi-client in tempo reale
- 📐 Sincronizzazione sfondo (grid/plain)
- 🎨 Sincronizzazione disegno canvas
- 🚫 Prevenzione loop infiniti di sincronizzazione
- 📡 Pusher-based real-time communication

## Tecnologie

- React + TypeScript
- Vite
- Fabric.js
- Pusher (real-time communication)
- Supabase (storage)

## Setup

1. **Configura Pusher**:
   - Crea un account su [Pusher](https://pusher.com)
   - Crea una nuova app
   - Copia l'**App Key** e il **Cluster**

2. **Configura le variabili d'ambiente**:
   ```bash
   cp .env.example .env
   ```
   
   Modifica `.env` con le tue credenziali:
   ```env
   VITE_PUSHER_APP_KEY=la-tua-app-key
   VITE_PUSHER_CLUSTER=il-tuo-cluster
   ```

3. **Installa le dipendenze**:
   ```bash
   npm install
   ```

4. **Avvia l'applicazione**:
   ```bash
   npm run dev
   ```

## Stato Sviluppo

✅ Implementata sincronizzazione canvas base
✅ Implementata sincronizzazione backgroundMode
✅ Migrato da WebSocket a Pusher per production-ready
✅ Configurazione ambiente Vercel
🚧 Test sincronizzazione multi-client con Pusher

## Note

Questo è un ambiente di sviluppo isolato per testare la sincronizzazione senza conflitti con il branch principale.

## Deploy

Il progetto è configurato per il deploy automatico su Vercel. Assicurati di configurare le variabili d'ambiente anche su Vercel:

- `VITE_PUSHER_APP_KEY`
- `VITE_PUSHER_CLUSTER`
