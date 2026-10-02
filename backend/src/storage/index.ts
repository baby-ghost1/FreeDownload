import { config } from '../server/config.js';
import { localStorage } from './local.js';
import { r2Storage } from './r2.js';
import type { Storage } from './types.js';

export { jobObjectKey } from './types.js';
export type { Storage, StoredObject } from './types.js';
export { localObjectPath, verifyFileToken } from './local.js';

let instance: Storage | null = null;

/** Selected by STORAGE_DRIVER — `r2` is the production choice. */
export function getStorage(): Storage {
  if (!instance) {
    instance = config.storage.driver === 'r2' ? r2Storage : localStorage;
  }
  return instance;
}

/** Test seam: reset the singleton between suites. */
export function resetStorage(): void {
  instance = null;
}
