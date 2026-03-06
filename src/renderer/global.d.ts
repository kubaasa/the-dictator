import type { DictatorAPI } from '../preload/preload';

declare global {
  interface Window {
    dictator: DictatorAPI;
  }
}

declare module '*.png' {
  const src: string;
  export default src;
}
