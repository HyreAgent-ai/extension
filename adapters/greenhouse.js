// adapters/greenhouse.js — Greenhouse ATS adapter
//
// PRE-BUILD VALIDATION RESULTS:
// CORS on Cloud Run: PASS (https://resume-compiler-1077806152183.us-central1.run.app — access-control-allow-origin: *)
// DataTransfer works on Greenhouse: NEEDS BROWSER VERIFICATION (see README)
// If DataTransfer fails on a real page: adapter highlights the file input with a red border so user can upload manually

const GH_URL_PATTERNS = [
  /job-boards\.greenhouse\.io\/(\w+)\/jobs\/(\d+)/,
  /boards\.greenhouse\.io\/(\w+)\/jobs\/(\d+)/,
  /jobs\.greenhouse\.io\/(\d+)/,
];

/**
 * Returns true if this URL is a Greenhouse job application page.
 */
export function detect(url) {
  return GH_URL_PATTERNS.some(p => p.test(url));
}

/**
 * Extract company slug from a Greenhouse URL.
 * Returns null for jobs.greenhouse.io/{id} format (no slug).
 */
export function extractSlug(url) {
  for (const p of GH_URL_PATTERNS.slice(0, 2)) {
    const m = url.match(p);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Fill the Greenhouse application form.
 *
 * @param {object} profile - user profile from chrome.storage.local
 * @param {ArrayBuffer|null} resumeBuffer - PDF bytes from Railway /generate
 * @returns {{ filled: string[], flagged: string[] }}
 */
export function fill(profile, resumeBuffer) {
  const filled = [];
  const flagged = [];

  _setField('#first_name', profile.firstName, filled, flagged, 'First Name');
  _setField('#last_name', profile.lastName, filled, flagged, 'Last Name');
  _setField('#email', profile.email, filled, flagged, 'Email');
  _setField('#phone', profile.phone, filled, flagged, 'Phone');
  _setField(
    'input[name*="linkedin"], input[id*="linkedin"]',
    profile.linkedinUrl,
    filled, flagged, 'LinkedIn'
  );

  // Work auth dropdowns — label-text matching (NOT name attribute — fragile)
  const authAnswer = profile.workAuth === 'authorized' ? 'Yes' : 'No';
  _fillSelectByLabel(/authorized to work/i, authAnswer, filled, flagged, 'Work Auth');

  const sponsorAnswer = profile.needsSponsorship ? 'Yes' : 'No';
  _fillSelectByLabel(/require.*sponsor|visa.*sponsor|need.*sponsor/i, sponsorAnswer, filled, flagged, 'Sponsorship');

  // Resume upload via DataTransfer
  if (resumeBuffer) {
    const input = _findResumeInput();
    if (_injectFile(input, resumeBuffer, 'resume.pdf', 'application/pdf')) {
      filled.push('Resume PDF');
    } else {
      _highlightInput(input);
      flagged.push('⚠ Resume — DataTransfer failed, upload manually (highlighted)');
    }
  } else {
    flagged.push('⚠ Resume — PDF not available, upload manually');
  }

  // Flag any custom questions
  const customQuestions = document.querySelectorAll('.custom-question, [class*="custom_question"]');
  if (customQuestions.length > 0) {
    customQuestions.forEach(q => {
      const label = q.querySelector('label')?.textContent?.trim() || 'Custom question';
      flagged.push(`⚠ ${label}`);
      q.style.outline = '2px solid #f59e0b';
    });
  }

  return { filled, flagged };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _setField(selector, value, filled, flagged, label) {
  if (!value) return;
  const el = document.querySelector(selector);
  if (!el) return;

  // Use native value setter to trigger React/Vue synthetic events if present
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (nativeSetter) nativeSetter.call(el, value);
  else el.value = value;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  filled.push(label);
}

function _fillSelectByLabel(labelRegex, answer, filled, flagged, label) {
  for (const select of document.querySelectorAll('select')) {
    const id = select.id;
    const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
    const labelText = labelEl?.textContent
      || select.closest('label')?.textContent
      || select.previousElementSibling?.textContent
      || '';

    if (!labelRegex.test(labelText)) continue;

    for (const opt of select.options) {
      if (opt.text.toLowerCase().includes(answer.toLowerCase())) {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        filled.push(label);
        return;
      }
    }
    flagged.push(`⚠ ${label} — no matching option for "${answer}"`);
    return;
  }
  // No matching select found — not necessarily an error (some GH apps omit work auth)
}

function _findResumeInput() {
  return document.querySelector('input[name="resume"]')
    || document.querySelector('input[type="file"][name*="resume"]')
    || document.querySelector('input[type="file"]');
}

function _injectFile(inputEl, buffer, filename, mimeType) {
  if (!inputEl || !buffer) return false;
  try {
    const blob = new Blob([buffer], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return inputEl.files.length > 0;
  } catch (e) {
    console.warn('[JobAgent] DataTransfer inject failed:', e.message);
    return false;
  }
}

function _highlightInput(inputEl) {
  if (!inputEl) return;
  inputEl.style.outline = '3px solid #dc2626';
  inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
