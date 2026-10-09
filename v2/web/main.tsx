import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { connect } from './api.ts';
import { App } from './App.tsx';
import './styles.css';

connect();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
