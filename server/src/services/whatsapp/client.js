import { getConfig } from '../../config/env.js';

// Thin client for the official WhatsApp Business Cloud API (graph.facebook.com).
// Shapes follow Meta's docs (checked 2026-10-28). fetch is injectable so tests
// never call Meta. Tokens are never logged.

export class WhatsAppError extends Error {
  constructor(message, { status, code, subcode, retryable = false } = {}) {
    super(message);
    this.name = 'WhatsAppError';
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.retryable = retryable;
  }
  /** Re-engagement error: more than 24 hours since the customer's last message. */
  get windowClosed() {
    return this.code === 131047 || /re-engagement|24 hours/i.test(this.message);
  }
  get authFailed() {
    return this.code === 190 || this.status === 401;
  }
}

async function parse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error || {};
    throw new WhatsAppError(e.error_data?.details || e.message || `WhatsApp responded ${res.status}`, {
      status: res.status,
      code: e.code,
      subcode: e.error_subcode,
      retryable: res.status >= 500 || res.status === 429 || [4, 80007, 130429, 131016].includes(e.code),
    });
  }
  return body;
}

export function createWhatsAppClient({ fetchImpl = fetch, config = () => getConfig().whatsapp } = {}) {
  const graph = (path) => `https://graph.facebook.com/${config().apiVersion}/${path}`;
  return {
    /** Details of a business phone number; also proves the token can use it. */
    async phoneNumber(token, phoneNumberId) {
      const url = new URL(graph(phoneNumberId));
      url.searchParams.set('fields', 'display_phone_number,verified_name,quality_rating');
      const r = await parse(await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }));
      return { phoneNumberId: String(r.id || phoneNumberId), displayPhoneNumber: r.display_phone_number, verifiedName: r.verified_name || null, qualityRating: r.quality_rating || null };
    },

    /** Free-form text (only inside the 24-hour customer service window). */
    async sendText(token, phoneNumberId, to, body) {
      const r = await parse(await fetchImpl(graph(`${phoneNumberId}/messages`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } }),
        signal: AbortSignal.timeout(20_000),
      }));
      return { messageId: r.messages?.[0]?.id, waId: r.contacts?.[0]?.wa_id || to };
    },
  };
}

let override;
/** Tests swap in a fake WhatsApp (same interface). */
export function setWhatsAppClientForTests(client) {
  override = client;
}
export function whatsappClient() {
  return override || createWhatsAppClient();
}
