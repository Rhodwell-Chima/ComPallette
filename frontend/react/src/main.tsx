import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthGate } from './components/AuthGate';
import { PlatformProvider } from './platform/PlatformContext';
import './index.css';
import { AlertSessionProvider } from './platform/AlertSessionContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter><AuthGate><PlatformProvider><AlertSessionProvider><App /></AlertSessionProvider></PlatformProvider></AuthGate></BrowserRouter>
  </React.StrictMode>
);
