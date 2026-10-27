import { getConfig } from '../../config/env.js';
import { hmac } from '../../lib/crypto.js';

// WhatsApp numbers are personal data: senders are looked up by a keyed hash,
// and suppression/display keys never contain the raw number.
export const waHash = (waId) => hmac(getConfig().authSecret, `whatsapp:${waId}`);
export const waKey = (waId) => `whatsapp:${waHash(waId).slice(0, 16)}`;
