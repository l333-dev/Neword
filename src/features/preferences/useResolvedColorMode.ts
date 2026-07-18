import { useEffect, useState } from "react";

import { resolveColorMode, type ResolvedColorMode } from "../../preferences/appearance";
import type { UserPreferences } from "../../preferences/userPreferences";

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function useResolvedColorMode(
  colorMode: UserPreferences["appearance"]["colorMode"],
): ResolvedColorMode {
  const [prefersDark, setPrefersDark] = useState(() => getSystemPrefersDark());

  useEffect(() => {
    const media = getColorSchemeMedia();
    if (!media) return;

    const onChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };

    setPrefersDark(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  return resolveColorMode(colorMode, prefersDark);
}

function getSystemPrefersDark(): boolean {
  return getColorSchemeMedia()?.matches ?? false;
}

function getColorSchemeMedia(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(COLOR_SCHEME_QUERY);
}
