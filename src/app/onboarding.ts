import { z } from "zod";

import {
  createStorageEnvelope,
  readStorageEnvelope,
  StorageEnvelopeSchema,
} from "../preferences/localStorageEnvelope";

export const ONBOARDING_STORAGE_KEY = "neword.onboarding.v1";

const OnboardingStateSchema = z.object({
  formatVersion: z.literal(1),
  firstRunGuideDismissed: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export type OnboardingState = z.infer<typeof OnboardingStateSchema>;
export const OnboardingStorageEnvelopeSchema = StorageEnvelopeSchema(OnboardingStateSchema);

export interface OnboardingStorage {
  load(key: string): string | null;
  save(key: string, value: string): void;
}

export function createLocalStorageOnboardingStorage(
  getLocalStorage = () => globalThis.window?.localStorage,
): OnboardingStorage {
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
  };
}

export function defaultOnboardingState(now = new Date()): OnboardingState {
  return {
    formatVersion: 1,
    firstRunGuideDismissed: false,
    updatedAt: now.toISOString(),
  };
}

export function loadOnboardingState(
  storage: OnboardingStorage = createLocalStorageOnboardingStorage(),
): OnboardingState {
  try {
    const raw = storage.load(ONBOARDING_STORAGE_KEY);
    if (!raw) return defaultOnboardingState();
    const parsedValue = JSON.parse(raw) as unknown;
    const enveloped = readStorageEnvelope(parsedValue, OnboardingStateSchema);
    if (enveloped === null) return defaultOnboardingState();
    const parsed = OnboardingStateSchema.safeParse(
      enveloped.enveloped ? enveloped.data : enveloped.data,
    );
    return parsed.success ? parsed.data : defaultOnboardingState();
  } catch {
    return defaultOnboardingState();
  }
}

export function dismissFirstRunGuide(state: OnboardingState, now = new Date()): OnboardingState {
  return {
    ...state,
    firstRunGuideDismissed: true,
    updatedAt: now.toISOString(),
  };
}

export function saveOnboardingState(
  state: OnboardingState,
  storage: OnboardingStorage = createLocalStorageOnboardingStorage(),
): boolean {
  const parsed = OnboardingStateSchema.safeParse(state);
  if (!parsed.success) return false;
  try {
    storage.save(ONBOARDING_STORAGE_KEY, JSON.stringify(createStorageEnvelope(parsed.data)));
    return true;
  } catch {
    return false;
  }
}
