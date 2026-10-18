import { Notification, CreatorProfile } from '../models/index.js';

const PREF_BY_TYPE = {
  new_opportunities: 'newOpportunities',
  approval_required: 'approvals',
  deadline: 'deadlines',
  payment_overdue: 'deadlines',
};

/**
 * Creates an in-app notification at most once per dedupeKey, so retries and
 * repeated discovery runs cannot spam the creator.
 * Returns true when a new notification was created.
 */
export async function notify(creatorId, { type, title, body, link, severity = 'info', dedupeKey }) {
  const pref = PREF_BY_TYPE[type];
  if (pref) {
    const profile = await CreatorProfile.findOne({ userId: creatorId }, { notifications: 1 }).lean();
    if (profile?.notifications && (profile.notifications.inApp === false || profile.notifications[pref] === false)) {
      return false;
    }
  }
  const res = await Notification.updateOne(
    { creatorId, dedupeKey },
    { $setOnInsert: { creatorId, dedupeKey, type, title, body, link, severity } },
    { upsert: true },
  );
  return res.upsertedCount === 1;
}
