// Serper.dev Google search API. Results are used only as leads: the app then
// fetches the linked pages itself, and evidence comes from those pages, not
// from the search result snippets.

const ENDPOINT = 'https://google.serper.dev/search';

export async function serperSearch(q, { apiKey, fetchImpl = fetch, num = 10 } = {}) {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ q, gl: 'in', hl: 'en', num }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw Object.assign(new Error(res.status === 401 || res.status === 403 ? 'Serper rejected the API key' : `Serper responded ${res.status}`), { status: res.status });
  const body = await res.json();
  return (body.organic || []).filter((r) => r?.link).map((r) => ({ title: String(r.title || ''), link: String(r.link), snippet: String(r.snippet || '') }));
}

/** Google News results for India via Serper. Leads only: articles are read by the app itself. */
export async function serperNews(q, { apiKey, fetchImpl = fetch, num = 20, now = new Date() } = {}) {
  const res = await fetchImpl('https://google.serper.dev/news', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ q, gl: 'in', hl: 'en', num, tbs: 'qdr:w' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw Object.assign(new Error(res.status === 401 || res.status === 403 ? 'Serper rejected the API key' : `Serper responded ${res.status}`), { status: res.status });
  const body = await res.json();
  return (body.news || []).filter((r) => r?.link).map((r) => ({ title: String(r.title || ''), link: String(r.link), publishedAt: relativeDate(r.date, now) }));
}

/** "3 hours ago" / "2 days ago" / "1 week ago" → Date (null when it can't be read). */
export function relativeDate(text, now = new Date()) {
  const m = /(\d+)\s+(minute|hour|day|week)s?\s+ago/i.exec(String(text || ''));
  if (!m) return null;
  const unit = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[m[2].toLowerCase()];
  return new Date(now.getTime() - Number(m[1]) * unit);
}
