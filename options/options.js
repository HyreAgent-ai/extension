// options.js — profile settings page logic

const PROFILE_KEY = 'jobagent_profile';

const DEFAULT_PROFILE = {
  firstName: '', lastName: '', email: '', phone: '',
  linkedinUrl: '', city: '', state: '',
  workAuth: 'authorized', needsSponsorship: true, visaStatus: 'F-1 OPT STEM',
  summary: '', skills_latex: '',
  compilerUrl: 'https://resume-compiler-1077806152183.us-central1.run.app',
};

// All field IDs that map directly to profile keys
const TEXT_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'linkedinUrl', 'city', 'state',
  'visaStatus', 'summary', 'skills_latex',
  'compilerUrl',
];
const SELECT_FIELDS = ['workAuth', 'needsSponsorship'];

async function loadProfile() {
  const result = await chrome.storage.local.get(PROFILE_KEY);
  const profile = { ...DEFAULT_PROFILE, ...result[PROFILE_KEY] };

  for (const field of TEXT_FIELDS) {
    const el = document.getElementById(field);
    if (el) el.value = profile[field] || '';
  }
  for (const field of SELECT_FIELDS) {
    const el = document.getElementById(field);
    if (el) el.value = String(profile[field]);
  }
}

async function saveProfile() {
  const profile = {};
  for (const field of TEXT_FIELDS) {
    const el = document.getElementById(field);
    if (el) profile[field] = el.value.trim();
  }
  for (const field of SELECT_FIELDS) {
    const el = document.getElementById(field);
    if (el) {
      // needsSponsorship is stored as boolean
      profile[field] = field === 'needsSponsorship' ? el.value === 'true' : el.value;
    }
  }

  const current = await chrome.storage.local.get(PROFILE_KEY);
  const merged = { ...DEFAULT_PROFILE, ...current[PROFILE_KEY], ...profile };
  await chrome.storage.local.set({ [PROFILE_KEY]: merged });

  const status = document.getElementById('save-status');
  status.textContent = '✓ Saved';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

// Wire connection UI
async function refreshAuthStatus() {
  const valid = await isSessionValid();
  const s = valid ? await getSession() : null;
  const status = document.getElementById('auth-status');
  const btnConnect = document.getElementById('btn-connect');
  const btnSignout = document.getElementById('btn-signout');
  if (valid && s) {
    status.textContent = `Signed in as ${s.user_id?.slice(0, 8) || 'user'}…`;
    btnConnect.textContent = 'Reconnect';
    btnSignout.style.display = 'inline-block';
  } else {
    status.textContent = 'Not connected to HyreAgent.';
    btnConnect.textContent = 'Connect to HyreAgent';
    btnSignout.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadProfile();
  document.getElementById('btn-save').addEventListener('click', saveProfile);

  document.getElementById('btn-connect').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://jobagent-web.vercel.app/connect-extension', active: true });
  });
  document.getElementById('btn-signout').addEventListener('click', async () => {
    await clearSession();
    await refreshAuthStatus();
  });
  refreshAuthStatus();
});
