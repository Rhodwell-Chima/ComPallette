import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthGate } from './components/AuthGate';
import { PlatformProvider } from './platform/PlatformContext';
import './index.css';
import { AlertSessionProvider } from './platform/AlertSessionContext';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}><BrowserRouter><AuthGate><PlatformProvider><AlertSessionProvider><App /></AlertSessionProvider></PlatformProvider></AuthGate></BrowserRouter></QueryClientProvider>
  </React.StrictMode>
);
