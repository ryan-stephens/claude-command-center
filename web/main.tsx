import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { followHistory } from './history.ts';
import { connect } from './ws.ts';
import './styles.css';

connect();
followHistory();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
