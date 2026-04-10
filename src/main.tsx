import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#1a2035',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#f3f4f6',
            fontFamily: 'Inter, system-ui, sans-serif',
          },
        }}
        theme="dark"
        richColors
      />
    </BrowserRouter>
  </React.StrictMode>
);
