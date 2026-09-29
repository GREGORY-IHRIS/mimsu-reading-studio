"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchUsage } from "../lib/client/api.js";

// Shares the Gemini usage numbers between the header button, the usage panel
// and the studios' "this will cost N requests" lines.

const UsageContext = createContext(null);

export function UsageProvider({ children }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");

  // days=1 is enough for the numbers next to the buttons; the panel asks for a longer history.
  const refresh = useCallback(async (days = 1) => {
    try {
      const data = await fetchUsage({ days });
      setOverview(data);
      setError("");
      return data;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, []);

  // Every /api/tts answer carries the latest numbers for today.
  const applyToday = useCallback((today) => {
    setOverview((prev) => (prev ? { ...prev, today: { ...prev.today, ...today } } : prev));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ overview, today: overview?.today ?? null, error, refresh, applyToday }),
    [overview, error, refresh, applyToday]
  );
  return <UsageContext.Provider value={value}>{children}</UsageContext.Provider>;
}

export function useUsage() {
  const value = useContext(UsageContext);
  if (!value) throw new Error("useUsage must be used inside <UsageProvider>");
  return value;
}
