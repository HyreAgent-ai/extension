// extension/lib/gateway.js
// Wraps fetch calls to the Vercel API gateway.
// Loaded via importScripts() in background.js (MV3 service worker).

const GATEWAY_URL = 'https://jobagent-web.vercel.app';

async function gatewayAuthHeaders() {
  const s = await getSession(); // getSession defined in session.js, loaded before this
  if (!s || !s.access_token) throw Object.assign(new Error('NO_SESSION'), { code: 'NO_SESSION' });
  return { 'Authorization': `Bearer ${s.access_token}` };
}

async function gatewayPost(path, body) {
  const headers = { 'Content-Type': 'application/json', ...(await gatewayAuthHeaders()) };
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`gateway POST ${path} ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}

async function gatewayPatch(path, body) {
  const headers = { 'Content-Type': 'application/json', ...(await gatewayAuthHeaders()) };
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`gateway PATCH ${path} ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}

async function gatewayGet(path) {
  const headers = await gatewayAuthHeaders();
  const res = await fetch(`${GATEWAY_URL}${path}`, { method: 'GET', headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`gateway GET ${path} ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json();
}
