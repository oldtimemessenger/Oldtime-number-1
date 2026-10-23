import { api } from "./store.js";

export const INTERESTS = ["Sports", "Photography", "Music", "Comedy", "Food", "Travel", "Fitness", "News", "Art", "Gaming", "Fashion", "Technology"];

function ownsAccount(accountId) {
  return [api.cloudAccountId(), api.me()?.id].filter(Boolean).includes(accountId);
}

export function readInterests(accountId) {
  if (!ownsAccount(accountId) || !api.cloudAccountStateLoaded()) return null;
  const preferences = api.cloudAccountState()?.interestPreferences;
  if (!preferences) return { enabled: true, selected: [], decided: false };
  return {
    enabled: preferences.enabled !== false,
    selected: [...new Set((Array.isArray(preferences.selected) ? preferences.selected : []).filter(item => INTERESTS.includes(item)))],
    decided: true,
  };
}

export async function saveInterests(accountId, { enabled = true, selected = [] }) {
  if (!ownsAccount(accountId)) throw new Error("Sign in to save your interests to your account.");
  const clean = [...new Set((Array.isArray(selected) ? selected : []).filter(item => INTERESTS.includes(item)))];
  await api.updateCloudAccountState({
    interestPreferences: { enabled: !!enabled, selected: clean },
  });
  return clean;
}

export async function resetInterests(accountId) {
  if (!ownsAccount(accountId)) throw new Error("Sign in to reset your interests.");
  await api.updateCloudAccountState({ interestPreferences: null });
}

export function interestContext(accountId) {
  const value = readInterests(accountId);
  return value ? { interests: value.enabled ? value.selected : [], interestsSet: value.decided } :
    { interests: [], interestsSet: true };
}
