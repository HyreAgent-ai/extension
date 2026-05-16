// lib/resolver.js — Aggregator link resolver for Chrome extension
//
// Some scraper job_url values point to aggregators (adzuna, click2apply, prng.co)
// rather than the actual ATS. This module detects and optionally resolves them.

const AGGREGATOR_PATTERNS = [
  /adzuna\.com/i,
  /click2apply\.net/i,
  /prng\.co/i,
  /aerocontact\.com/i,
  /appcast\.io/i,
  /jobscore\.com/i,
  /talentify\.io/i,
  /zipapply\.com/i,
  /apply\.workable\.com/i,  // not an aggregator per se but some links need resolution
];

/**
 * Returns true if the URL is a known aggregator redirect link.
 * Pure function — safe to unit test.
 */
export function isAggregatorUrl(url) {
  if (!url) return false;
  return AGGREGATOR_PATTERNS.some(p => p.test(url));
}

/**
 * Resolve an aggregator URL to the real ATS URL by following redirects.
 * Uses Chrome tabs API — only works in extension context (background or content script).
 *
 * @param {string} url - The aggregator URL to resolve
 * @param {number} [timeoutMs=8000] - Max wait time in ms
 * @returns {Promise<string>} - Resolved URL, or original URL on failure/timeout
 */
export async function resolveUrl(url, timeoutMs = 8000) {
  if (!isAggregatorUrl(url)) return url;

  return new Promise(resolve => {
    let tabId = null;
    let settled = false;

    const done = (finalUrl) => {
      if (settled) return;
      settled = true;
      if (tabId != null) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
      resolve(finalUrl || url);
    };

    const timer = setTimeout(() => done(url), timeoutMs);

    // Listen for the tab to finish loading
    const onUpdated = (id, changeInfo, tab) => {
      if (id !== tabId) return;
      if (changeInfo.status !== 'complete') return;
      const finalUrl = tab.url || url;
      // If it's still on an aggregator page, wait (might still be redirecting)
      if (isAggregatorUrl(finalUrl) && (Date.now() - startTime) < timeoutMs - 1000) return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      done(finalUrl);
    };

    const startTime = Date.now();
    chrome.tabs.onUpdated.addListener(onUpdated);

    // Open a hidden tab (active: false keeps it in background)
    chrome.tabs.create({ url, active: false })
      .then(tab => {
        tabId = tab.id;
      })
      .catch(e => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        done(url);
      });
  });
}
