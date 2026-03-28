import * as Sentry from '@sentry/electron/renderer';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../index.css';

Sentry.init({});

const root = createRoot(document.getElementById('app')!);
root.render(<App />);
