/// <reference types="vite/client" />

/** Injected by Vite `define` from package.json — the running app version. */
declare const __APP_VERSION__: string;

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
