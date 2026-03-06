import type { DictatorAPI } from '../preload/index';

declare global {
  interface Window {
    dictator: DictatorAPI;
  }
}
