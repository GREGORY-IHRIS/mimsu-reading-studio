"use client";

import { useCallback, useState } from "react";
import {
  createFolder, deleteHistoryEntry, patchHistoryEntry, removeFolder, renameFolder,
} from "../lib/client/api.js";

// Every change to the library (rename, star, move, delete, folder edits) goes
// through here, so the two places that list recordings behave the same way:
// mark the entry busy, call the API, hand the fresh library back.
export default function useLibraryActions(onLibrary) {
  const [busyId, setBusyId] = useState(null);

  const guarded = useCallback(async (id, change) => {
    setBusyId(id);
    try {
      onLibrary(await change());
      return true;
    } catch (error) {
      alert(error.message);
      return false;
    } finally {
      setBusyId(null);
    }
  }, [onLibrary]);

  return {
    busyId,
    patch: (id, patch) => guarded(id, () => patchHistoryEntry(id, patch)),
    remove: (id) => guarded(id, () => deleteHistoryEntry(id)),
    addFolder: (name) => guarded("folder", () => createFolder(name)),
    renameFolder: (from, to) => guarded("folder", () => renameFolder(from, to)),
    removeFolder: (name) => guarded("folder", () => removeFolder(name)),
  };
}
