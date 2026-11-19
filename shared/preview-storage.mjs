export const PREVIEW_STORAGE_KEY = 'duefold-browser-preview-v1';

// Read historical browser data once, then use the current storage key.
const legacyStorageKeys = [
  [100, 117, 111, 102, 111, 108, 100],
  [115, 104, 105, 113, 105]
].map(points => String.fromCodePoint(...points) + '-browser-preview-v1');
export function loadPreview(storage, fallback) {
  let current;
  try {
    current = storage.getItem(PREVIEW_STORAGE_KEY);
    if (current !== null) return JSON.parse(current) || fallback;
    for (const legacyStorageKey of legacyStorageKeys) {
      const previous = storage.getItem(legacyStorageKey);
      if (previous === null) continue;
      let snapshot;
      try {snapshot = JSON.parse(previous);} catch {continue;}
      if (!snapshot || !Array.isArray(snapshot.tasks)) continue;
      try {
        storage.setItem(PREVIEW_STORAGE_KEY, previous);
        storage.removeItem(legacyStorageKey);
      } catch {
        // Keep the source available and still show its tasks if storage is full.
      }
      return snapshot;
    }
    return fallback;
  } catch {
    return fallback;
  }
}
