import * as Sentry from '@sentry/electron/renderer';
import log from 'electron-log/renderer';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../index.css';

Sentry.init({});

document.addEventListener('securitypolicyviolation', (event) => {
  log.warn('CSP violation: %s blocked %s', event.violatedDirective, event.blockedURI);
});

const container = document.getElementById('app');
if (container) createRoot(container).render(<App />);
