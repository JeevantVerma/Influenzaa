import { getConfig } from '../../config/env.js';
import { IntegrationConnection } from '../../models/index.js';
import { decryptSecret } from '../../lib/crypto.js';
import { instagramClient } from './client.js';

// Sending Instagram DMs. Kept separate from instagram.service.js so the
// messaging service can use it without an import cycle.

export const INSTAGRAM_WINDOW_MS = 24 * 3_600_000;
export const INSTAGRAM_MAX_BYTES = 1000;
export const INSTAGRAM_WINDOW_CLOSED = "Instagram's 24-hour reply window has closed, so nothing was sent. Copy the text and send it from Instagram yourself, or wait for the brand's next message.";

/** When the brand's last DM opened the reply window, and when it closes (null if never opened). */
export function instagramWindow(conversation, now = new Date()) {
  if (!conversation?.lastInboundAt) return { open: false, closesAt: null };
  const closesAt = new Date(new Date(conversation.lastInboundAt).getTime() + INSTAGRAM_WINDOW_MS);
  return { open: closesAt > now, closesAt };
}

export async function instagramToken(creatorId) {
  const conn = await IntegrationConnection.findOne({ creatorId, provider: 'instagram' }).select('+encryptedCredentialReference').lean();
  if (!conn || conn.status !== 'connected' || !conn.encryptedCredentialReference) return null;
  return { token: decryptSecret(conn.encryptedCredentialReference, getConfig().tokenKeys), conn };
}

/** Reason a DM cannot be sent right now, or null. Nothing is sent when this returns a reason. */
export async function instagramSendBlock(message, conversation, now = new Date()) {
  const brand = conversation.participants.find((p) => p.side === 'brand');
  if (!brand?.instagramId) return 'This brand has not messaged you on Instagram yet, so CreatorOS cannot reply there. Nothing was sent.';
  if (!instagramWindow(conversation, now).open) return INSTAGRAM_WINDOW_CLOSED;
  if (Buffer.byteLength(message.content, 'utf8') > INSTAGRAM_MAX_BYTES) return 'This message is longer than Instagram allows (1000 bytes). Shorten it and try again. Nothing was sent.';
  if (!(await instagramToken(message.creatorId))) return 'Instagram is not connected for this account. Nothing was sent.';
  return null;
}

/** Sends an approved DM; returns the same shape as the email adapters. */
export async function sendInstagramMessage(message, conversation) {
  const { token } = await instagramToken(message.creatorId);
  const brand = conversation.participants.find((p) => p.side === 'brand');
  const r = await instagramClient().sendText(token, brand.instagramId, message.content);
  return { status: 'sent', provider: 'instagram', providerMessageId: r.messageId };
}
