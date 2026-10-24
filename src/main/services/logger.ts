import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';

log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = 'debug';

log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}]{scope} {text}';
log.transports.console.format = '[{level}]{scope} {text}';

// API key patterns masked in logs and Sentry events (sentry.ts imports this). Add the
// prefix of every new provider here.
const API_KEY_PATTERNS = [
  /sk-proj-[A-Za-z0-9_-]+/g,
  /sk-ant-[A-Za-z0-9_-]+/g,
  /gsk_[A-Za-z0-9_-]+/g,
];

export function redactApiKeys(text: string): string {
  let s = text;
  for (const p of API_KEY_PATTERNS) {
    s = s.replace(p, (m) => m.slice(0, 8) + '***');
  }
  return s;
}

log.hooks.push((message) => {
  message.data = message.data.map((item) => (typeof item === 'string' ? redactApiKeys(item) : item));
  return message;
});

// electron-log runs every hook once per transport (console, file, ipc…); forwarding to
// Sentry from a single transport keeps one log call = one event / one breadcrumb.
log.hooks.push((message, _transport, transportName) => {
  if (transportName !== 'console') return message;
  if (message.level === 'error') {
    const errorObj = message.data.find((item): item is Error => item instanceof Error);
    if (errorObj) {
      Sentry.captureException(errorObj, {
        extra: { logMessage: message.data.filter((item) => typeof item === 'string').join(' ') },
      });
    } else {
      Sentry.captureMessage(message.data.join(' '), 'error');
    }
  }
  const breadcrumbLevel: Sentry.SeverityLevel =
    message.level === 'warn' ? 'warning'
      : message.level === 'verbose' || message.level === 'silly' ? 'debug'
        : message.level;
  Sentry.addBreadcrumb({
    message: message.data.filter((item) => typeof item === 'string').join(' '),
    level: breadcrumbLevel,
    category: message.scope || 'app',
  });
  return message;
});

log.initialize();

export default log;
