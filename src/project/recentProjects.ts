import { z } from "zod";

export const RECENT_PROJECTS_STORAGE_KEY = "neword.recentProjects.v1";
export const MAX_RECENT_PROJECTS = 10;

export const RecentProjectEntrySchema = z.object({
  path: z.string().min(1),
  displayName: z.string().min(1),
  lastOpenedAt: z.iso.datetime(),
});

export const RecentProjectsSchema = z.object({
  formatVersion: z.literal(1),
  entries: z.array(RecentProjectEntrySchema).max(MAX_RECENT_PROJECTS),
});

export type RecentProjectEntry = z.infer<typeof RecentProjectEntrySchema>;
export type RecentProjects = z.infer<typeof RecentProjectsSchema>;

export interface RecentProjectsStorage {
  load(key: string): string | null;
  save(key: string, value: string): void;
  remove(key: string): void;
}

export function createLocalStorageRecentProjectsStorage(
  getLocalStorage = () => globalThis.window?.localStorage,
): RecentProjectsStorage {
  return {
    load(key) {
      const storage = getLocalStorage();
      if (!storage) throw new Error("localStorage is unavailable");
      return storage.getItem(key);
    },
    save(key, value) {
      const storage = getLocalStorage();
      if (!storage) throw new Error("localStorage is unavailable");
      storage.setItem(key, value);
    },
    remove(key) {
      const storage = getLocalStorage();
      if (!storage) throw new Error("localStorage is unavailable");
      storage.removeItem(key);
    },
  };
}

export function fileNameFromProjectPath(path: string): string {
  return path.replaceAll("\\", "/").split("/").at(-1) || path;
}

export function getDefaultRecentProjects(): RecentProjects {
  return { formatVersion: 1, entries: [] };
}

export function sanitizeRecentProjects(value: unknown): RecentProjects {
  const parsed = RecentProjectsSchema.safeParse(value);
  if (parsed.success) return normalizeRecentProjects(parsed.data);
  if (typeof value !== "object" || value === null) return getDefaultRecentProjects();
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return getDefaultRecentProjects();
  const validEntries = entries
    .map((entry) => RecentProjectEntrySchema.safeParse(entry))
    .filter((entry): entry is z.ZodSafeParseSuccess<RecentProjectEntry> => entry.success)
    .map((entry) => entry.data);
  return normalizeRecentProjects({ formatVersion: 1, entries: validEntries });
}

export function normalizeRecentProjects(recent: RecentProjects): RecentProjects {
  const byPath = new Map<string, RecentProjectEntry>();
  for (const entry of recent.entries) {
    const previous = byPath.get(entry.path);
    if (!previous || Date.parse(entry.lastOpenedAt) > Date.parse(previous.lastOpenedAt)) {
      byPath.set(entry.path, entry);
    }
  }
  return {
    formatVersion: 1,
    entries: [...byPath.values()]
      .sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt))
      .slice(0, MAX_RECENT_PROJECTS),
  };
}

export function addRecentProject(
  recent: RecentProjects,
  input: { path: string; displayName?: string; now?: Date },
): RecentProjects {
  return normalizeRecentProjects({
    formatVersion: 1,
    entries: [
      {
        path: input.path,
        displayName: input.displayName?.trim() || fileNameFromProjectPath(input.path),
        lastOpenedAt: (input.now ?? new Date()).toISOString(),
      },
      ...recent.entries.filter((entry) => entry.path !== input.path),
    ],
  });
}

export function removeRecentProject(recent: RecentProjects, path: string): RecentProjects {
  return {
    formatVersion: 1,
    entries: recent.entries.filter((entry) => entry.path !== path),
  };
}

export function clearRecentProjects(): RecentProjects {
  return getDefaultRecentProjects();
}

export function loadRecentProjects(
  storage: RecentProjectsStorage = createLocalStorageRecentProjectsStorage(),
): RecentProjects {
  try {
    const raw = storage.load(RECENT_PROJECTS_STORAGE_KEY);
    if (!raw) return getDefaultRecentProjects();
    return sanitizeRecentProjects(JSON.parse(raw) as unknown);
  } catch {
    return getDefaultRecentProjects();
  }
}

export function saveRecentProjects(
  recent: RecentProjects,
  storage: RecentProjectsStorage = createLocalStorageRecentProjectsStorage(),
): boolean {
  const parsed = RecentProjectsSchema.safeParse(normalizeRecentProjects(recent));
  if (!parsed.success) return false;
  try {
    storage.save(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}
