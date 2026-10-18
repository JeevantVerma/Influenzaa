import { hashObject } from '../../lib/crypto.js';

/** JSON round-trip so the stored action and its hash survive a database round-trip unchanged. */
export function normalizeAction(action) {
  return JSON.parse(JSON.stringify(action ?? {}));
}

export function computeActionHash({ actionType, proposedAction, boundTermsVersion }) {
  return hashObject({ actionType, proposedAction, boundTermsVersion: boundTermsVersion ?? null });
}
