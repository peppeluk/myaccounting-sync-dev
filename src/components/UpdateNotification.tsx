import React, { useState, useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface UpdateNotificationProps {
  className?: string;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({ className = '' }) => {
  const [showUpdate, setShowUpdate] = useState(false);
  const [updateSW, setUpdateSW] = useState<(() => void) | null>(null);

  useEffect(() => {
    const swUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        setShowUpdate(true);
        setUpdateSW(() => () => {
          // Force refresh to get new version
          window.location.reload();
        });
      },
      onOfflineReady() {
        console.log("App pronta per funzionare offline");
      },
    });

    return () => swUpdate();
  }, []);

  const handleUpdate = () => {
    if (updateSW) {
      updateSW();
    }
  };

  const handleDismiss = () => {
    setShowUpdate(false);
  };

  if (!showUpdate) return null;

  return (
    <div className={`fixed top-4 right-4 z-50 max-w-sm ${className}`}>
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-gray-900">
              Aggiornamento disponibile
            </h3>
            <div className="mt-2 text-sm text-gray-500">
              È disponibile una nuova versione dell'applicazione con miglioramenti e correzioni.
            </div>
            <div className="mt-3 flex space-x-2">
              <button
                onClick={handleUpdate}
                className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Aggiorna ora
              </button>
              <button
                onClick={handleDismiss}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Dopo
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
