/* Launchpad — database helper.
   Extracted from launchserve-demo (Dancing Cup).
   Change from original: URL and key are configured at runtime, never hardcoded.

   Usage:
     import { configure, db } from './core/db.js';
     configure({ url: '...', key: '...' });
     const rows = await db('GET', '/rest/v1/table?select=*');
*/

let CFG = { url: null, key: null };

export function configure({ url, key }) {
  if (!url || !key) throw new Error('LP-001: db.configure needs url and key');
  CFG = { url, key };
}

export async function db(method, path, body, extraHeaders) {
  if (!CFG.url) throw new Error('LP-002: call configure() before db()');

  const headers = {
    apikey: CFG.key,
    Authorization: 'Bearer ' + CFG.key,
    'Content-Type': 'application/json'
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  if (method === 'POST') headers.Prefer = 'return=representation';

  const res = await fetch(CFG.url + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok && res.status !== 204) {
    throw new Error('LP-003: ' + method + ' ' + path + ' returned ' + res.status);
  }
  if (res.status === 204) return null;

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
