// background.js — MV3 Service Worker
// Handles cross-origin fetches (resume compiler, Vercel API gateway)
// Content scripts and popups message this worker for privileged operations

importScripts('lib/session.js', 'lib/gateway.js');

const ALLOWED_SENDER_ORIGINS = [
  'https://jobagent-web.vercel.app',
];

// ── External messages from SPA (AUTH_SET / AUTH_CLEAR) ────────────────────────
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!sender.url || !ALLOWED_SENDER_ORIGINS.some(o => sender.url.startsWith(o))) {
    sendResponse({ ok: false, error: 'unauthorized origin' });
    return;
  }
  if (msg.type === 'AUTH_SET') {
    const { access_token, refresh_token, expires_at, user_id } = msg;
    if (!access_token || !user_id) {
      sendResponse({ ok: false, error: 'missing fields' });
      return;
    }
    setSession({ access_token, refresh_token, expires_at, user_id })
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // keep channel open for async
  }
  if (msg.type === 'AUTH_CLEAR') {
    clearSession()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  sendResponse({ ok: false, error: 'unknown message type' });
});

// ── Sender allowlist for internal onMessage ───────────────────────────────────
const ALLOWED_TAB_HOSTS = [
  'https://boards.greenhouse.io',
  'https://job-boards.greenhouse.io',
  'https://jobs.lever.co',
];

function isAllowedSender(sender) {
  // Popup and options pages have no tab — allow them
  if (!sender.tab) return true;
  // Content scripts must come from allowed ATS hosts
  const url = sender.tab.url || '';
  return ALLOWED_TAB_HOSTS.some(h => url.startsWith(h)) ||
    /^https:\/\/[^/]+\.greenhouse\.io\//.test(url) ||
    /^https:\/\/[^/]+\.lever\.co\//.test(url);
}

// ── Internal messages from popup / content scripts ────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isAllowedSender(sender)) {
    sendResponse({ ok: false, error: 'unauthorized sender' });
    return;
  }
  if (msg.type === 'FETCH_PDF') {
    handleFetchPdf(msg, sendResponse);
    return true;
  }
  if (msg.type === 'FETCH_COVER_LETTER') {
    handleFetchCoverLetter(msg, sendResponse);
    return true;
  }
  if (msg.type === 'MARK_APPLIED') {
    handleMarkApplied(msg, sendResponse);
    return true;
  }
  if (msg.type === 'FETCH_PIPELINE') {
    handleFetchPipeline(msg, sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[JobAgent] Extension installed');
});

// ── Railway PDF fetch ─────────────────────────────────────────────────────────
async function handleFetchPdf(msg, sendResponse) {
  const { compilerUrl, variant, summary, skills_latex, company, role } = msg;
  try {
    const res = await fetch(`${compilerUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant, summary, skills_latex, company, role }),
    });
    if (!res.ok) throw new Error(`Railway /generate ${res.status}: ${await res.text()}`);
    const buffer = await res.arrayBuffer();
    sendResponse({ ok: true, buffer });
  } catch (e) {
    console.error('[JobAgent] handleFetchPdf error:', e.message);
    sendResponse({ ok: false, error: e.message });
  }
}

async function handleFetchCoverLetter(msg, sendResponse) {
  const { compilerUrl, company, role, summary, variant_focus } = msg;
  try {
    const res = await fetch(`${compilerUrl}/generate-cover-letter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, role, summary, variant_focus }),
    });
    if (!res.ok) throw new Error(`Railway /generate-cover-letter ${res.status}: ${await res.text()}`);
    const buffer = await res.arrayBuffer();
    sendResponse({ ok: true, buffer });
  } catch (e) {
    console.error('[JobAgent] handleFetchCoverLetter error:', e.message);
    sendResponse({ ok: false, error: e.message });
  }
}

// ── Fetch Pipeline via gateway ────────────────────────────────────────────────
async function handleFetchPipeline(msg, sendResponse) {
  try {
    const result = await gatewayGet('/api/v1/pipeline');
    sendResponse({ ok: true, jobs: result.jobs });
  } catch (e) {
    sendResponse({ ok: false, error: e.message, code: e.code || null });
  }
}

// ── Mark Applied via gateway ───────────────────────────────────────────────────
async function handleMarkApplied(msg, sendResponse) {
  const { job, resumeVariant } = msg;
  try {
    const today = new Date().toISOString().slice(0, 10);

    await gatewayPost('/api/v1/applications', {
      id: job.id,
      role: job.role,
      company: job.company,
      location: job.location || null,
      link: job.applyUrl,
      status: 'Applied',
      date: today,
      resumeVariant: resumeVariant || job.resumeVariant || null,
      match: job.match || null,
      verdict: job.verdict || null,
    });

    await gatewayPatch(`/api/v1/user_job_feed/${encodeURIComponent(job.id)}`, {
      in_pipeline: false,
    });

    sendResponse({ ok: true });
  } catch (e) {
    console.error('[JobAgent] handleMarkApplied error:', e.message);
    sendResponse({
      ok: false,
      error: e.message,
      code: e.code || (e.message === 'NO_SESSION' ? 'NO_SESSION' : null),
    });
  }
}
