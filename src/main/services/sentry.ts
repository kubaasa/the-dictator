import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';

export function initSentry(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || 'https://fe49979aba83ebbf4b29e86ee0b8e20d@o4511101234970624.ingest.de.sentry.io/4511101262561360',
    environment: app.isPackaged ? 'production' : 'development',
    release: `the-dictator@${app.getVersion()}`,

    // Don't send events in dev mode
    enabled: app.isPackaged,

    // Filter sensitive data
    beforeSend(event) {
      if (event.message) {
        event.message = event.message
          .replace(/sk-proj-[A-Za-z0-9_-]+/g, 'sk-proj-***')
          .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***')
          .replace(/gsk_[A-Za-z0-9_-]+/g, 'gsk_***');
      }
      return event;
    },
  });
}
