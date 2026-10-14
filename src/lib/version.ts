/**
 * The running app version. Injected by Vite's `define` from package.json;
 * falls back to 'dev' in environments without the define (e.g. the jsdom
 * smoke harness).
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
