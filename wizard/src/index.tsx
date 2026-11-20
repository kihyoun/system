import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
const root = document.getElementById('root');
if (!root)
    throw new Error('Missing application root.');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
// Retire legacy CRA workers so a restored server cannot retain an old interface.
if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => { void registration.unregister(); });
    });
}
