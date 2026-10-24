import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';
import { redactApiKeys as redact } from './logger';

export function initSentry(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || undefined,
    environment: app.isPackaged ? 'production' : 'development',
    release: `the-dictator@${app.getVersion()}`,

    enabled: app.isPackaged,

    beforeSend(event) {
      if (event.message) {
        event.message = redact(event.message);
      }

      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = redact(ex.value);
        }
      }

      if (event.breadcrumbs) {
        for (const bc of event.breadcrumbs) {
          if (bc.message) bc.message = redact(bc.message);
        }
      }

      return event;
    },
  });
}
