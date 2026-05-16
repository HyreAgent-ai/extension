// lib/profile.js — profile read/write helpers for chrome.storage.local

const PROFILE_KEY = 'jobagent_profile';

const DEFAULT_PROFILE = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  linkedinUrl: '',
  city: '',
  state: '',
  workAuth: 'authorized',       // 'authorized' | 'not_authorized'
  needsSponsorship: true,
  visaStatus: 'F-1 OPT STEM',
  summary: '',                  // plain text resume summary — required for Railway /generate
  skills_latex: '',             // raw LaTeX skills block — required for Railway /generate
  compilerUrl: 'https://resume-compiler-1077806152183.us-central1.run.app',
};

export async function getProfile() {
  const result = await chrome.storage.local.get(PROFILE_KEY);
  return { ...DEFAULT_PROFILE, ...result[PROFILE_KEY] };
}

export async function saveProfile(updates) {
  const current = await getProfile();
  const merged = { ...current, ...updates };
  await chrome.storage.local.set({ [PROFILE_KEY]: merged });
  return merged;
}
