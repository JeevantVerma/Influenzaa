import { CreatorProfile, DiscoveryConfiguration } from '../models/index.js';
import { ONBOARDING_STEPS } from '../models/CreatorProfile.js';
import { notFound } from '../lib/errors.js';
import { recordAudit } from './audit.service.js';

/** Flattens a nested patch into dotted $set paths; arrays and primitives are replaced wholesale. */
export function toSetPaths(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) toSetPaths(v, path, out);
    else out[path] = v;
  }
  return out;
}

export async function getProfile(creatorId) {
  const profile = await CreatorProfile.findOne({ userId: creatorId }).lean();
  if (!profile) throw notFound('Creator profile');
  return profile;
}

export async function updateProfile(creatorId, patch) {
  const { completeStep, ...fields } = patch;
  const set = toSetPaths(fields);
  if (set['audienceMetrics.avgViews'] !== undefined || set['audienceMetrics.engagementRatePercent'] !== undefined) {
    set['audienceMetrics.source'] = 'creator_entered'; // never presented as verified
    set['audienceMetrics.updatedAt'] = new Date();
  }
  if (fields.platformProfiles) {
    set.platformProfiles = fields.platformProfiles.map((p) => ({ ...p, metricsSource: 'creator_entered' }));
  }
  const update = { $set: set };
  if (completeStep) update.$addToSet = { 'onboardingStatus.completedSteps': completeStep };
  let profile = await CreatorProfile.findOneAndUpdate({ userId: creatorId }, update, { returnDocument: 'after', runValidators: true });
  if (!profile) throw notFound('Creator profile');

  if (completeStep) {
    const done = new Set(profile.onboardingStatus.completedSteps);
    const next = ONBOARDING_STEPS.find((s) => !done.has(s));
    profile.onboardingStatus.currentStep = next || 'done';
    if (!next && !profile.onboardingStatus.completed) {
      profile.onboardingStatus.completed = true;
      profile.onboardingStatus.completedAt = new Date();
    }
    await profile.save();
  }
  // Niches unblock discovery that was waiting for configuration.
  if (fields.niches?.length) {
    await DiscoveryConfiguration.updateOne({ creatorId, status: 'awaiting_configuration' }, { $set: { status: 'stopped' } });
  }
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'profile.updated', resourceType: 'creator_profile', resourceId: profile._id, metadata: { fields: Object.keys(fields), completeStep } });
  return profile.toObject();
}

/** Autonomy and outbound automation permissions — only the creator, only with explicit confirmation. */
export async function updateAutonomy(creatorId, { level, autoSendPitches, autoSendFollowUps }) {
  const set = {};
  if (level !== undefined) {
    set['negotiationAutonomy.level'] = level;
    set['negotiationAutonomy.updatedAt'] = new Date();
  }
  if (autoSendPitches !== undefined) set['automation.autoSendPitches'] = autoSendPitches;
  if (autoSendFollowUps !== undefined) set['automation.followUps.autoSend'] = autoSendFollowUps;
  const profile = await CreatorProfile.findOneAndUpdate({ userId: creatorId }, { $set: set }, { returnDocument: 'after' });
  if (!profile) throw notFound('Creator profile');
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'settings.autonomy_changed', resourceType: 'creator_profile', resourceId: profile._id, metadata: { level, autoSendPitches, autoSendFollowUps } });
  return profile.toObject();
}
