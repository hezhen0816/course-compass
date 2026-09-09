import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/global.css';
import './features/next/next.css';
import { NextApp } from './features/next/NextApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode><NextApp /></StrictMode>,
);
