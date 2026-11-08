import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider, SiteProvider, ToastProvider } from './lib';
import './index.css';
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><ToastProvider><SiteProvider><AuthProvider><App /></AuthProvider></SiteProvider></ToastProvider></BrowserRouter></StrictMode>);
