import { getConfig } from '../../config/env.js';

// Thin client for the official Instagram API with Instagram Login
// (graph.instagram.com). Shapes follow Meta's docs (checked 2026-10-22):
// business login, Conversations API and Send API. fetch is injectable so
// tests never call Meta. Tokens are never logged.

export class InstagramError extends Error {
  constructor(message, { status, code, subcode, retryable = false } = {}) {
    super(message);
    this.name = 'InstagramError';
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.retryable = retryable;
  }
  /** Meta's "outside of allowed window" error for the Send API. */
  get windowClosed() {
    return this.code === 10 || this.subcode === 2534022 || /outside of allowed window/i.test(this.message);
  }
  /** Expired, revoked or invalid access token. */
  get authFailed() {
    return this.code === 190 || this.status === 401;
  }
}

async function parse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error || {};
    throw new InstagramError(e.message || `Instagram responded ${res.status}`, {
      status: res.status,
      code: e.code,
      subcode: e.error_subcode,
      retryable: res.status >= 500 || res.status === 429 || e.code === 4 || e.code === 32 || e.is_transient === true,
    });
  }
  return body;
}

export function createInstagramClient({ fetchImpl = fetch, config = () => getConfig().instagram } = {}) {
  const graph = (path) => `https://graph.instagram.com/${config().apiVersion}/${path}`;
  const get = async (path, token, params = {}) => {
    const url = new URL(graph(path));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return parse(await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }));
  };

  return {
    /** Instagram login URL for one creator (state is checked on the callback). */
    authorizeUrl(state) {
      const c = config();
      const url = new URL('https://www.instagram.com/oauth/authorize');
      url.searchParams.set('client_id', c.appId);
      url.searchParams.set('redirect_uri', c.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'instagram_business_basic,instagram_business_manage_messages');
      url.searchParams.set('state', state);
      return url.toString();
    },

    /** Login code → short-lived token → long-lived (≈60 day) token. */
    async exchangeCode(code) {
      const c = config();
      const form = new URLSearchParams({ client_id: c.appId, client_secret: c.appSecret, grant_type: 'authorization_code', redirect_uri: c.redirectUri, code: String(code).replace(/#_$/, '') });
      const short = await parse(await fetchImpl('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form, signal: AbortSignal.timeout(20_000) }));
      const entry = Array.isArray(short.data) ? short.data[0] : short;
      const url = new URL('https://graph.instagram.com/access_token');
      url.searchParams.set('grant_type', 'ig_exchange_token');
      url.searchParams.set('client_secret', c.appSecret);
      url.searchParams.set('access_token', entry.access_token);
      const long = await parse(await fetchImpl(url, { signal: AbortSignal.timeout(20_000) }));
      return { accessToken: long.access_token, expiresIn: long.expires_in, permissions: String(entry.permissions || '').split(',').filter(Boolean) };
    },

    /** Extends a long-lived token by another ~60 days (needs the token to be ≥ 24 h old and unexpired). */
    async refreshToken(token) {
      const url = new URL('https://graph.instagram.com/refresh_access_token');
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', token);
      const r = await parse(await fetchImpl(url, { signal: AbortSignal.timeout(20_000) }));
      return { accessToken: r.access_token, expiresIn: r.expires_in };
    },

    async me(token) {
      const r = await get('me', token, { fields: 'user_id,username,account_type' });
      // user_id is the professional account's Instagram id; id is app-scoped. Messages may use either.
      return { igUserId: String(r.user_id || r.id), appScopedId: r.id ? String(r.id) : null, username: r.username, accountType: r.account_type || null };
    },

    /** Subscribes the account to message events for this app (the dashboard's "Webhook Subscription" switch). */
    async subscribeToMessages(token, igUserId) {
      const url = new URL(graph(`${igUserId}/subscribed_apps`));
      url.searchParams.set('subscribed_fields', 'messages');
      const r = await parse(await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }));
      return r.success === true;
    },

    /** Recently active conversations: [{ id, updatedTime: Date }]. */
    async conversations(token, { limit = 25 } = {}) {
      const r = await get('me/conversations', token, { platform: 'instagram', fields: 'id,updated_time', limit: String(limit) });
      return (r.data || []).map((c) => ({ id: c.id, updatedTime: c.updated_time ? new Date(c.updated_time) : null }));
    },

    /** Message ids in a conversation, newest first. Only the latest 20 can be read in full. */
    async messageIds(token, conversationId) {
      const r = await get(conversationId, token, { fields: 'messages' });
      return (r.messages?.data || []).map((m) => ({ id: m.id, createdTime: m.created_time ? new Date(m.created_time) : null }));
    },

    async message(token, messageId) {
      const r = await get(messageId, token, { fields: 'id,created_time,from,to,message' });
      return {
        id: r.id,
        createdTime: r.created_time ? new Date(r.created_time) : null,
        from: { id: r.from?.id ? String(r.from.id) : null, username: r.from?.username || null },
        to: (r.to?.data || []).map((t) => ({ id: t.id ? String(t.id) : null, username: t.username || null })),
        text: r.message || '',
      };
    },

    /** Sends a text DM (≤ 1000 bytes) to an Instagram-scoped user id. */
    async sendText(token, recipientId, text) {
      const r = await parse(await fetchImpl(graph('me/messages'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
        signal: AbortSignal.timeout(20_000),
      }));
      return { messageId: r.message_id, recipientId: r.recipient_id };
    },
  };
}

let override;
/** Tests swap in a fake Instagram (same interface). */
export function setInstagramClientForTests(client) {
  override = client;
}
export function instagramClient() {
  return override || createInstagramClient();
}
