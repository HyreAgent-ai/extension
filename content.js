// content.js — JobAgent content script
// Injected into Greenhouse and Lever pages

const PROFILE_KEY = 'jobagent_profile';

// ── DOM construction helper ───────────────────────────────────────────────────
// Builds elements safely — user data is always set as textContent, never
// interpolated into HTML strings, eliminating XSS risk (SEC-06).

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'className') e.className = v;
    else e[k] = v;
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FILL_FORM') {
    handleFillForm(msg).catch(e => {
      console.error('[JobAgent] FILL_FORM error:', e);
    });
    sendResponse({ ok: true }); // ack immediately; fill is async
  }
});

// ── Main fill handler ─────────────────────────────────────────────────────────

async function handleFillForm({ job, variant }) {
  // Load profile from storage
  const result = await chrome.storage.local.get(PROFILE_KEY);
  const profile = result[PROFILE_KEY] || {};

  const url = window.location.href;
  const ats = detectAts(url);

  if (!ats) {
    console.warn('[JobAgent] Unrecognized ATS on this page');
    return;
  }

  // Fetch resume PDF via background service worker
  const compilerUrl = profile.compilerUrl || 'https://resume-compiler-1077806152183.us-central1.run.app';
  const pdfResponse = await chrome.runtime.sendMessage({
    type: 'FETCH_PDF',
    compilerUrl,
    variant,
    summary: profile.summary || '',
    skills_latex: profile.skills_latex || '',
    company: job.company,
    role: job.role,
  });

  let resumePdfBuffer = null;
  if (pdfResponse.ok) {
    resumePdfBuffer = pdfResponse.buffer;
  } else {
    console.warn('[JobAgent] PDF fetch failed:', pdfResponse.error);
  }

  // Fill the form using the right adapter
  const filled = [];
  const flagged = [];

  if (ats === 'greenhouse') {
    fillGreenhouse(profile, resumePdfBuffer, filled, flagged);
  } else if (ats === 'lever') {
    fillLever(profile, resumePdfBuffer, filled, flagged);
  }

  // Show confirm overlay
  showOverlay(filled, flagged, job, variant);
}

// ── ATS detection ─────────────────────────────────────────────────────────────

function detectAts(url) {
  if (/greenhouse\.io/.test(url)) return 'greenhouse';
  if (/lever\.co/.test(url)) return 'lever';
  return null;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function setField(selector, value, filled, flagged, label) {
  const el = document.querySelector(selector);
  if (!el || !value) {
    if (label) flagged.push(label);
    return false;
  }
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  filled.push(label || selector);
  return true;
}

function fillSelectByLabel(labelRegex, answer, filled, flagged, label) {
  // Find all select elements whose preceding label text matches the regex
  const selects = document.querySelectorAll('select');
  for (const select of selects) {
    // Check associated label
    const id = select.id;
    const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null;
    const labelText = labelEl?.textContent || select.closest('label')?.textContent || '';
    if (!labelRegex.test(labelText)) continue;

    // Find option whose text matches the answer
    for (const opt of select.options) {
      if (opt.text.toLowerCase().includes(answer.toLowerCase())) {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        filled.push(label || labelText.trim());
        return true;
      }
    }
    // Select exists but answer not found
    flagged.push(`⚠ ${label || labelText.trim()} — check manually`);
    return false;
  }
  return false;
}

function injectFile(inputEl, buffer, filename, mimeType) {
  if (!inputEl || !buffer) return false;
  try {
    const blob = new Blob([buffer], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (e) {
    console.warn('[JobAgent] DataTransfer inject failed:', e.message);
    return false;
  }
}

// ── Greenhouse adapter ────────────────────────────────────────────────────────

function fillGreenhouse(profile, resumeBuffer, filled, flagged) {
  setField('#first_name', profile.firstName, filled, flagged, 'First Name');
  setField('#last_name', profile.lastName, filled, flagged, 'Last Name');
  setField('#email', profile.email, filled, flagged, 'Email');
  setField('#phone', profile.phone, filled, flagged, 'Phone');
  setField('input[name*="linkedin"], input[id*="linkedin"]', profile.linkedinUrl, filled, flagged, 'LinkedIn');

  // Work auth — label-text matching
  const authAnswer = profile.workAuth === 'authorized' ? 'Yes' : 'No';
  fillSelectByLabel(/authorized to work/i, authAnswer, filled, flagged, 'Work Auth');
  const sponsorAnswer = profile.needsSponsorship ? 'Yes' : 'No';
  fillSelectByLabel(/sponsor/i, sponsorAnswer, filled, flagged, 'Sponsorship');

  // Resume upload via DataTransfer
  if (resumeBuffer) {
    const resumeInput = document.querySelector('input[name="resume"]')
      || document.querySelector('input[type="file"][name*="resume"]')
      || document.querySelector('input[type="file"]');
    if (injectFile(resumeInput, resumeBuffer, 'resume.pdf', 'application/pdf')) {
      filled.push('Resume PDF');
    } else {
      flagged.push('⚠ Resume — upload manually');
    }
  } else {
    flagged.push('⚠ Resume — PDF fetch failed, upload manually');
  }
}

// ── Lever adapter ─────────────────────────────────────────────────────────────

function fillLever(profile, resumeBuffer, filled, flagged) {
  const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  setField('input[name="name"]', fullName, filled, flagged, 'Full Name');
  setField('input[name="email"]', profile.email, filled, flagged, 'Email');
  setField('input[name="phone"]', profile.phone, filled, flagged, 'Phone');
  setField('input[name="urls[LinkedIn]"]', profile.linkedinUrl, filled, flagged, 'LinkedIn');

  // Resume upload
  const fileInputs = document.querySelectorAll('input[type="file"]');
  const resumeInput = Array.from(fileInputs).find(i => !i.name?.includes('cover')) || fileInputs[0];
  if (resumeBuffer && injectFile(resumeInput, resumeBuffer, 'resume.pdf', 'application/pdf')) {
    filled.push('Resume PDF');
  } else {
    flagged.push('⚠ Resume — upload manually');
  }
}

// ── Confirm overlay ───────────────────────────────────────────────────────────

function showOverlay(filled, flagged, job, variant) {
  // Remove any existing overlay
  document.getElementById('__jobagent_overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__jobagent_overlay';
  overlay.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
    width: 280px; background: #fff; border: 2px solid #6d28d9;
    border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px; color: #111827; overflow: hidden;
  `;

  // Header bar
  const closeBtn = el('span', { id: '__ja_close', style: { cursor: 'pointer', fontSize: '16px', lineHeight: '1' } }, '×');
  const header = el('div', {
    style: {
      background: '#6d28d9', color: '#fff', padding: '10px 14px',
      fontWeight: '700', fontSize: '13px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    },
  }, '🧩 JobAgent — Review & Submit', closeBtn);

  // Job metadata — job.company and job.role set as text nodes, never as HTML
  const jobMeta = el('div', { style: { fontSize: '11px', fontWeight: '700', color: '#374151', marginBottom: '6px' } });
  jobMeta.appendChild(document.createTextNode(job.company));
  jobMeta.appendChild(document.createTextNode(' · '));
  jobMeta.appendChild(document.createTextNode(job.role));

  // variant is also set as text node
  const variantLabel = el('div', { style: { fontSize: '10px', color: '#6b7280', marginBottom: '8px' } }, 'Variant: ');
  variantLabel.appendChild(document.createTextNode(variant));

  // Field status rows — filled/flagged labels are internal strings, not user data
  const fieldList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '10px', fontSize: '12px' } });
  for (const f of filled) {
    fieldList.appendChild(el('div', { style: { color: '#15803d' } }, `✓ ${f}`));
  }
  for (const f of flagged) {
    fieldList.appendChild(el('div', { style: { color: '#d97706' } }, f));
  }

  const submitBtn = el('button', {
    id: '__ja_submit',
    style: { width: '100%', padding: '10px', background: '#15803d', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
  }, '✅ Submit Application');

  const cancelBtn = el('button', {
    id: '__ja_cancel',
    style: { width: '100%', padding: '7px', background: 'transparent', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', marginTop: '6px' },
  }, '✗ Cancel');

  const body = el('div', { style: { padding: '12px 14px' } }, jobMeta, variantLabel, fieldList, submitBtn, cancelBtn);

  overlay.appendChild(header);
  overlay.appendChild(body);

  document.body.appendChild(overlay);

  closeBtn.onclick = () => overlay.remove();
  cancelBtn.onclick = () => overlay.remove();

  submitBtn.onclick = async () => {
    const btn = submitBtn;
    btn.textContent = 'Submitting...';
    btn.disabled = true;

    // Click the real submit button
    const submitBtn = document.querySelector(
      'input[type="submit"], button[type="submit"], button[data-submit]'
    );
    if (submitBtn) {
      submitBtn.click();
    }

    // Wait for URL change or success element (max 8s)
    const submitted = await waitForSuccess(5000);
    if (submitted) {
      overlay.replaceChildren(
        el('div', { style: { padding: '20px', textAlign: 'center' } },
          el('div', { style: { fontSize: '28px', marginBottom: '8px' } }, '✅'),
          el('div', { style: { fontWeight: '700', color: '#15803d' } }, 'Application submitted!'),
          el('div', { style: { fontSize: '11px', color: '#6b7280', marginTop: '4px' } }, 'Marking as Applied in JobAgent...'),
        )
      );
      // Notify background to write back to Supabase
      const markRes = await chrome.runtime.sendMessage({
        type: 'MARK_APPLIED',
        job,
        resumeVariant: variant,
      });
      if (!markRes?.ok && markRes?.code === 'EXTENSION_AUTH_BROKEN') {
        // Show error in overlay — replace success content using DOM API (SEC-06)
        // job.role and job.company go into the href via encodeURIComponent, not raw HTML
        const manualUrl = 'https://jobagent-web.vercel.app/applied'
          + '?prefill_role=' + encodeURIComponent(job.role)
          + '&prefill_company=' + encodeURIComponent(job.company);

        const errCloseBtn = el('button', {
          id: '__ja_close2',
          style: { width: '100%', padding: '6px', background: 'transparent', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: '#6b7280', fontFamily: 'inherit' },
        }, 'Dismiss');

        const p1 = el('p', { style: { margin: '0 0 8px' } }, 'The application was submitted but ');
        p1.appendChild(el('strong', {}, 'couldn\'t be saved'));
        p1.appendChild(document.createTextNode(' to your account due to a known issue.'));

        const logLink = el('a', {
          href: manualUrl,
          target: '_blank',
          style: { display: 'block', padding: '8px 12px', background: '#7c3aed', color: '#fff', borderRadius: '6px', textAlign: 'center', fontWeight: '700', textDecoration: 'none', marginBottom: '8px' },
        }, 'Log manually in HyreAgent →');

        overlay.replaceChildren(
          el('div', { style: { background: '#dc2626', color: '#fff', padding: '10px 14px', fontWeight: '700', fontSize: '13px' } }, '⚠ Mark Applied failed'),
          el('div', { style: { padding: '12px 14px', fontSize: '12px', lineHeight: '1.5', color: '#111827' } },
            p1,
            el('p', { style: { margin: '0 0 8px' } }, 'Please log it manually in the web app:'),
            logLink,
            errCloseBtn,
          ),
        );
        errCloseBtn.onclick = () => overlay.remove();
        // Also notify popup to show the banner
        chrome.runtime.sendMessage({ type: 'MARK_APPLIED_FAILED', code: 'EXTENSION_AUTH_BROKEN' });
      } else {
        setTimeout(() => overlay.remove(), 3000);
      }
    } else {
      btn.textContent = '✅ Submit Application';
      btn.disabled = false;
      const note = document.createElement('div');
      note.style.cssText = 'color:#dc2626;font-size:11px;margin-top:6px;text-align:center;';
      note.textContent = 'Could not detect submission. Submit manually, then close this overlay.';
      btn.after(note);
    }
  };
}

// ── Success detection ─────────────────────────────────────────────────────────

function waitForSuccess(timeoutMs) {
  return new Promise(resolve => {
    const startUrl = window.location.href;
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 300;
      // URL changed = probably navigated to confirmation page
      if (window.location.href !== startUrl) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      // Greenhouse success message
      if (document.querySelector('.application-confirmation, [class*="confirmation"], [class*="success"]')) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      if (elapsed >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 300);
  });
}
