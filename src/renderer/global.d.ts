import type { DictatorAPI } from '../preload/preload';

declare global {
  interface Window {
    dictator: DictatorAPI;
  }
}
