import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { getPersistedValue, setPersistedValue } from "./storage";

export function usePersistedState<T>(key: string, defaultValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    const persisted = getPersistedValue<T>(key);
    if (persisted !== undefined) return persisted;
    return typeof defaultValue === "function" ? (defaultValue as () => T)() : defaultValue;
  });

  useEffect(() => {
    setPersistedValue(key, state);
  }, [key, state]);

  return [state, setState];
}
