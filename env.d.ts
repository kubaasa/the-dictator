// Type declarations for environment variables injected by the dev script
declare namespace NodeJS {
  interface ProcessEnv {
    VITE_DEV_SERVER_URL?: string;
  }
}
