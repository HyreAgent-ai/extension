// extension/lib/session.js
// Manages the opaque session token in chrome.storage.
// Loaded via importScripts() in background.js (MV3 service worker).

const SESSION_KEY = 'jobagent_session';

async function getSession() {
  const result = await chrome.storage.local.get(SESSION_KEY);
  return result[SESSION_KEY] || null;
}

async function setSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

async function clearSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

async function isSessionValid() {
  const s = await getSession();
  if (!s || !s.access_token) return false;
  if (s.expires_at && s.expires_at * 1000 < Date.now()) return false;
  return true;
}
