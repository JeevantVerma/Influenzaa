// Apify actor runs (used for Instagram). Every run carries a hard cost cap
// (maxTotalChargeUsd) and an item cap, so a misconfiguration cannot run up a bill.

const BASE = 'https://api.apify.com/v2';

export async function runActor(actor, input, { token, fetchImpl = fetch, timeoutSecs = 240, maxItems, maxTotalChargeUsd } = {}) {
  const params = new URLSearchParams({ timeout: String(timeoutSecs), format: 'json', clean: 'true' });
  if (maxItems) params.set('maxItems', String(maxItems));
  if (maxTotalChargeUsd) params.set('maxTotalChargeUsd', String(maxTotalChargeUsd));
  const res = await fetchImpl(`${BASE}/acts/${actor.replace('/', '~')}/run-sync-get-dataset-items?${params}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((timeoutSecs + 30) * 1000),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch {
      // body was not JSON
    }
    const reason = res.status === 401 ? 'Apify rejected the API token' : res.status === 402 ? 'Apify account has no remaining credit' : res.status === 408 ? 'Apify run timed out' : `Apify responded ${res.status}`;
    throw Object.assign(new Error(detail ? `${reason}: ${detail.slice(0, 160)}` : reason), { status: res.status });
  }
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}
