// popup.js — JobAgent popup logic

// --- ATS detection (inlined to avoid ES module import in popup) ---
const GH_PATTERNS = [
  /job-boards\.greenhouse\.io\/(\w+)\/jobs\/(\d+)/,
  /boards\.greenhouse\.io\/(\w+)\/jobs\/(\d+)/,
  /jobs\.greenhouse\.io\/(\d+)/,
];
const LEVER_PATTERNS = [/jobs\.lever\.co\/([\w-]+)/];

function detectAts(url) {
  if (GH_PATTERNS.some(p => p.test(url))) return 'greenhouse';
  if (LEVER_PATTERNS.some(p => p.test(url))) return 'lever';
  return null;
}

function extractSlug(url, ats) {
  const patterns = ats === 'greenhouse' ? GH_PATTERNS : LEVER_PATTERNS;
  for (const p of patterns) {
    const m = url.match(p);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
}

function matchJob(currentUrl, jobs) {
  const ats = detectAts(currentUrl);
  if (!ats) return null;
  const slug = extractSlug(currentUrl, ats);
  if (!slug) return null;
  return jobs.find(j => j.applyUrl && j.applyUrl.toLowerCase().includes(slug)) || null;
}

// --- Pipeline fetch via background service worker ---
async function loadPipeline() {
  const response = await chrome.runtime.sendMessage({ type: 'FETCH_PIPELINE' });
  if (!response?.ok) {
    if (response?.code === 'NO_SESSION') {
      $id('no-session-banner').style.display = '';
    }
    throw new Error(response?.error || 'Failed to load pipeline');
  }
  return response.jobs;
}

// --- UI helpers ---
function $id(id) { return document.getElementById(id); }

function showOnly(id) {
  ['loading', 'no-match', 'job-card'].forEach(s => {
    $id(s).style.display = s === id ? '' : 'none';
  });
}

function setBadge(ats) {
  const badge = $id('ats-badge');
  if (!ats) { badge.textContent = ''; badge.className = ''; return; }
  badge.textContent = ats.charAt(0).toUpperCase() + ats.slice(1);
  badge.className = ats;
}

// --- Main ---
document.addEventListener('DOMContentLoaded', async () => {
  // Listen for Mark Applied failure from content script via background (RELI-16)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'MARK_APPLIED_FAILED') {
      if (msg.code === 'NO_SESSION') {
        $id('no-session-banner').style.display = '';
      } else if (msg.code === 'EXTENSION_AUTH_BROKEN') {
        $id('auth-broken-banner').style.display = '';
      } else {
        // Generic fallback: show error banner with the raw error code so the user
        // knows the save failed even when we don't have a specific recovery flow.
        const detail = $id('mark-applied-error-detail');
        if (detail) {
          detail.textContent = `The application may not have been recorded (code: ${msg.code || 'UNKNOWN'}). Please log it manually.`;
        }
        $id('mark-applied-error-banner').style.display = '';
      }
    }
  });

  // Wire options link
  $id('btn-options').addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Wire recovery link — shown when Mark Applied is known-broken (RELI-17)
  $id('manual-log-link').addEventListener('click', (e) => {
    e.preventDefault();
    const role = encodeURIComponent(window._currentJob?.role || '');
    const company = encodeURIComponent(window._currentJob?.company || '');
    const url = `https://jobagent-web.vercel.app/applied?prefill_role=${role}&prefill_company=${company}`;
    chrome.tabs.create({ url, active: true });
  });

  // Wire fallback recovery link — shown for generic MARK_APPLIED errors (RELI-16)
  $id('manual-log-link-fallback').addEventListener('click', (e) => {
    e.preventDefault();
    const role = encodeURIComponent(window._currentJob?.role || '');
    const company = encodeURIComponent(window._currentJob?.company || '');
    const url = `https://jobagent-web.vercel.app/applied?prefill_role=${role}&prefill_company=${company}`;
    chrome.tabs.create({ url, active: true });
  });

  // Wire connect link — shown when extension has no session token (NO_SESSION)
  $id('connect-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://jobagent-web.vercel.app/connect-extension', active: true });
  });

  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab?.url || '';
  const ats = detectAts(currentUrl);
  setBadge(ats);

  if (!ats) {
    showOnly('no-match');
    $id('no-match').textContent = 'Not an ATS page. Navigate to a Greenhouse or Lever job posting.';
    return;
  }

  // Load pipeline via gateway (session check is implicit — NO_SESSION banner shows if not connected)
  let job;
  try {
    const pipeline = await loadPipeline();
    job = matchJob(currentUrl, pipeline);
  } catch (e) {
    showOnly('no-match');
    $id('no-match').textContent = `Error loading pipeline: ${e.message}`;
    return;
  }

  if (!job) {
    showOnly('no-match');
    $id('no-match').textContent = 'No pipeline job matched this page. Add the job to your pipeline first.';
    return;
  }

  // Show job card
  showOnly('job-card');
  window._currentJob = job;
  $id('job-role').textContent = job.role;
  $id('job-company').textContent = job.company;

  // Show meta tags
  const meta = $id('job-meta');
  if (job.match != null) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `${job.match}% match`;
    meta.appendChild(tag);
  }
  if (job.verdict) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = job.verdict;
    meta.appendChild(tag);
  }

  // Variant picker: show if no variant set on the job
  const variantSelect = $id('variant-select');
  if (job.resumeVariant) {
    variantSelect.value = job.resumeVariant;
    $id('variant-picker').style.display = 'none';
  } else {
    $id('variant-picker').style.display = '';
  }

  // Enable fill button
  const btn = $id('btn-fill');
  btn.disabled = false;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    $id('fill-status').textContent = 'Sending fill command...';

    const variant = job.resumeVariant || variantSelect.value || 'A';

    // Send FILL_FORM message to content script on the active tab
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'FILL_FORM',
        job,
        variant,
      });
      $id('fill-status').textContent = 'Filling form — review the overlay on the page.';
    } catch (e) {
      $id('fill-status').textContent = `Error: ${e.message}. Make sure you are on the job application page.`;
      btn.disabled = false;
    }
  });
});
