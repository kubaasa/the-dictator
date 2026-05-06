import { app } from 'electron';
import path from 'node:path';

export function getAssetPath(filename: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, filename)
    : path.join(app.getAppPath(), 'assets', filename);
}
