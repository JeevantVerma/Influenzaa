import { getConfig } from '../../config/env.js';
import { IntegrationConnection } from '../../models/index.js';
import { decryptSecret } from '../../lib/crypto.js';
import { whatsappClient } from './client.js';

// Sending WhatsApp messages. Kept separate from whatsapp.service.js so the
// messaging service can use it without an import cycle.

export const WHATSAPP_WINDOW_MS = 24 * 3_600_000;
export const WHATSAPP_MAX_CHARS = 4096;
export const WHATSAPP_WINDOW_CLOSED = "WhatsApp's 24-hour reply window has closed, so nothing was sent. Copy the text and send it from your WhatsApp yourself, or wait for the brand's next message.";

/** When the brand's last message opened the customer service window, and when it closes. */
export function whatsappWindow(conversation, now = new Date()) {
  if (!conversation?.lastInboundAt) return { open: false, closesAt: null };
  const closesAt = new Date(new Date(conversation.lastInboundAt).getTime() + WHATSAPP_WINDOW_MS);
  return { open: closesAt > now, closesAt };
}

export async function whatsappToken(creatorId) {
  const conn = await IntegrationConnection.findOne({ creatorId, provider: 'whatsapp' }).select('+encryptedCredentialReference').lean();
  if (!conn || conn.status !== 'connected' || !conn.encryptedCredentialReference) return null;
  return { token: decryptSecret(conn.encryptedCredentialReference, getConfig().authSecret), conn };
}

/** Reason a WhatsApp message cannot be sent right now, or null. Nothing is sent when this returns a reason. */
export async function whatsappSendBlock(message, conversation, now = new Date()) {
  const brand = conversation.participants.find((p) => p.side === 'brand');
  if (!brand?.waId) return 'This brand has not messaged you on WhatsApp yet, so CreatorOS cannot write to them there. Nothing was sent.';
  if (!whatsappWindow(conversation, now).open) return WHATSAPP_WINDOW_CLOSED;
  if (message.content.length > WHATSAPP_MAX_CHARS) return 'This message is longer than WhatsApp allows (4096 characters). Shorten it and try again. Nothing was sent.';
  if (!(await whatsappToken(message.creatorId))) return 'WhatsApp is not connected for this account. Nothing was sent.';
  return null;
}

/** Sends an approved message; returns the same shape as the email adapters. */
export async function sendWhatsAppMessage(message, conversation) {
  const { token, conn } = await whatsappToken(message.creatorId);
  const brand = conversation.participants.find((p) => p.side === 'brand');
  const r = await whatsappClient().sendText(token, conn.whatsapp.phoneNumberId, brand.waId, message.content);
  return { status: 'sent', provider: 'whatsapp', providerMessageId: r.messageId };
}
