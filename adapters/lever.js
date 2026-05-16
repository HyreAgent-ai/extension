// adapters/lever.js — Lever ATS adapter

const LEVER_URL_PATTERN = /jobs\.lever\.co\/([\w-]+)/;

/**
 * Returns true if this URL is a Lever job application page.
 */
export function detect(url) {
  return LEVER_URL_PATTERN.test(url);
}

/**
 * Extract company slug from a Lever URL.
 * e.g. 'https://jobs.lever.co/shieldai/abc' → 'shieldai'
 */
export function extractSlug(url) {
  const m = url.match(LEVER_URL_PATTERN);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Fill the Lever application form.
 *
 * @param {object} profile - user profile from chrome.storage.local
 * @param {ArrayBuffer|null} resumeBuffer - PDF bytes from Railway /generate
 * @returns {{ filled: string[], flagged: string[] }}
 */
export function fill(profile, resumeBuffer) {
  const filled = [];
  const flagged = [];

  // Lever uses a combined full-name field
  const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  _setField('input[name="name"]', fullName, filled, flagged, 'Full Name');
  _setField('input[name="email"]', profile.email, filled, flagged, 'Email');
  _setField('input[name="phone"]', profile.phone, filled, flagged, 'Phone');
  _setField('input[name="urls[LinkedIn]"]', profile.linkedinUrl, filled, flagged, 'LinkedIn');
  // Leave current company blank — Lever asks for current org, not the one you're applying to
  // _setField('input[name="org"]', '', filled, flagged, 'Current Company');

  // Resume upload — first file input (or one labelled "resume")
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
  const resumeInput = fileInputs.find(i => {
    const label = i.closest('label')?.textContent?.toLowerCase()
      || document.querySelector(`label[for="${i.id}"]`)?.textContent?.toLowerCase()
      || i.name?.toLowerCase()
      || '';
    return label.includes('resume') || label.includes('cv');
  }) || fileInputs[0];

  if (resumeBuffer && resumeInput) {
    if (_injectFile(resumeInput, resumeBuffer, 'resume.pdf', 'application/pdf')) {
      filled.push('Resume PDF');
    } else {
      _highlightInput(resumeInput);
      flagged.push('⚠ Resume — DataTransfer failed, upload manually (highlighted)');
    }
  } else if (!resumeBuffer) {
    flagged.push('⚠ Resume — PDF not available, upload manually');
  } else {
    flagged.push('⚠ Resume — no file input found');
  }

  // Custom questions — highlight unfilled ones
  const customInputs = document.querySelectorAll(
    'input[data-field-type]:not([name="name"]):not([name="email"]):not([name="phone"]):not([name="org"]):not([type="file"]), textarea[data-field-type]'
  );
  customInputs.forEach(input => {
    if (!input.value) {
      const label = input.closest('.application-question')?.querySelector('label')?.textContent?.trim()
        || input.placeholder
        || 'Custom field';
      flagged.push(`⚠ ${label}`);
      input.style.outline = '2px solid #f59e0b';
    }
  });

  return { filled, flagged };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _setField(selector, value, filled, flagged, label) {
  if (!value) return;
  const el = document.querySelector(selector);
  if (!el) return;

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
