// adapters/index.js — ATS platform detection from URL

const GH_PATTERNS = [
  /job-boards\.greenhouse\.io\/(\w+)\/jobs\/(\d+)/,
  /boards\.greenhouse\.io\/(\w+)\/jobs\/(\d+)/,
  /jobs\.greenhouse\.io\/(\d+)/,
];

const LEVER_PATTERNS = [
  /jobs\.lever\.co\/([\w-]+)/,
];

/**
 * Detect ATS platform from a URL.
 * Returns 'greenhouse', 'lever', or null.
 */
export function detectAts(url) {
  if (GH_PATTERNS.some(p => p.test(url))) return 'greenhouse';
  if (LEVER_PATTERNS.some(p => p.test(url))) return 'lever';
  return null;
}

/**
 * Extract company slug from a Greenhouse URL.
 * e.g. 'https://boards.greenhouse.io/rocketlab/jobs/123' → 'rocketlab'
 */
export function extractGreenhouseSlug(url) {
  // Only the first two patterns have a company slug in group 1.
  // GH_PATTERNS[2] (jobs.greenhouse.io/ID) has no company slug.
  for (const p of GH_PATTERNS.slice(0, 2)) {
    const m = url.match(p);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Extract company slug from a Lever URL.
 * e.g. 'https://jobs.lever.co/shieldai/abc' → 'shieldai'
 */
export function extractLeverSlug(url) {
  const m = url.match(LEVER_PATTERNS[0]);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Match current tab URL to a pipeline job.
 * Matches by checking if the job's applyUrl contains the slug from the current URL.
 */
export function matchPipelineJob(currentUrl, pipelineJobs) {
  const ats = detectAts(currentUrl);
  if (!ats) return null;

  const slug = ats === 'greenhouse'
    ? extractGreenhouseSlug(currentUrl)
    : extractLeverSlug(currentUrl);

  if (!slug) return null;

  return pipelineJobs.find(job => {
    if (!job.applyUrl) return false;
    return job.applyUrl.toLowerCase().includes(slug);
  }) || null;
}
