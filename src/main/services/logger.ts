import log from 'electron-log/main';
import * as Sentry from '@sentry/electron/main';

log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = 'debug';

log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}]{scope} {text}';
log.transports.console.format = '[{level}]{scope} {text}';

// API key sanitizer — masks sensitive values before they reach any transport
log.hooks.push((message) => {
  const patterns = [
    /sk-proj-[A-Za-z0-9_-]+/g,
    /sk-ant-[A-Za-z0-9_-]+/g,
    /gsk_[A-Za-z0-9_-]+/g,
  ];

  message.data = message.data.map((item) => {
    if (typeof item !== 'string') return item;
    let s = item;
    for (const p of patterns) {
      s = s.replace(p, (m) => m.slice(0, 8) + '***');
    }
    return s;
  });

  return message;
});

log.hooks.push((message) => {
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
  Sentry.addBreadcrumb({
    message: message.data.filter((item) => typeof item === 'string').join(' '),
    level: message.level === 'warn' ? 'warning' : message.level,
    category: message.scope || 'app',
  });
  return message;
});

log.initialize();

export default log;
