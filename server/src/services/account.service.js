import {
  ApprovalRequest, AuditEvent, BrandContact, Campaign, Conversation, CreatorProfile, Deal, DiscoveryConfiguration, DiscoveryRun,
  IntegrationConnection, Invoice, Message, Notification, Opportunity, ScheduledJob, Session, Suppression, User,
} from '../models/index.js';
import { verifyPassword } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';
import { recordAudit } from './audit.service.js';

/** Full export of a creator's own records (DPDP-style data access). */
export async function exportCreatorData(creatorId) {
  const q = { creatorId };
  const [user, profile, discovery, runs, opportunities, conversations, messages, deals, approvals, campaigns, invoices, integrations, notifications, audit, contacts] = await Promise.all([
    User.findById(creatorId).lean(),
    CreatorProfile.findOne({ userId: creatorId }).lean(),
    DiscoveryConfiguration.findOne(q).lean(),
    DiscoveryRun.find(q).lean(),
    Opportunity.find(q).lean(),
    Conversation.find(q).lean(),
    Message.find(q).lean(),
    Deal.find(q).lean(),
    ApprovalRequest.find(q).lean(),
    Campaign.find(q).lean(),
    Invoice.find(q).lean(),
    IntegrationConnection.find(q).lean(),
    Notification.find(q).lean(),
    AuditEvent.find(q).lean(),
    BrandContact.find({ ownerCreatorId: creatorId }).lean(),
  ]);
  delete user.passwordHash;
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'account.exported', resourceType: 'user', resourceId: creatorId });
  return {
    exportedAt: new Date(),
    format: 'creatoros-export-v1',
    user, profile, discovery, discoveryRuns: runs, opportunities, conversations, messages, deals, approvals, campaigns, invoices, integrations, notifications, auditEvents: audit, privateContacts: contacts,
  };
}

/**
 * Permanently deletes the creator's personal data. Shared brand profiles are
 * not personal data of the creator and are retained; the creator's private
 * contacts and suppression entries are removed. A minimal audit record of the
 * deletion (no personal data) is kept.
 */
export async function deleteAccount(creatorId, password) {
  const user = await User.findById(creatorId).select('+passwordHash');
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw unauthorized('Password is incorrect');
  const q = { creatorId };
  await Promise.all([
    CreatorProfile.deleteOne({ userId: creatorId }),
    DiscoveryConfiguration.deleteMany(q), DiscoveryRun.deleteMany(q), Opportunity.deleteMany(q), Conversation.deleteMany(q), Message.deleteMany(q),
    Deal.deleteMany(q), ApprovalRequest.deleteMany(q), Campaign.deleteMany(q), Invoice.deleteMany(q), IntegrationConnection.deleteMany(q),
    Notification.deleteMany(q), ScheduledJob.deleteMany(q), Suppression.deleteMany(q), BrandContact.deleteMany({ ownerCreatorId: creatorId }),
    Session.deleteMany({ userId: creatorId }), AuditEvent.deleteMany(q),
  ]);
  await User.deleteOne({ _id: creatorId });
  await recordAudit({ actorType: 'system', eventType: 'account.deleted', resourceType: 'user', resourceId: creatorId });
}
