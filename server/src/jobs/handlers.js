import { runDiscovery } from '../services/discovery/pipeline.js';
import { deliverMessage, onSendExhausted } from '../services/messaging.service.js';
import { runFollowUpCheck } from '../services/followup.service.js';
import { expireStaleApprovals } from '../services/approvals/approval.service.js';
import { scanDeadlinesAndInvoices } from '../services/campaign.service.js';
import { processInboundMessage, flagInboundForReview } from '../services/negotiation/negotiation.service.js';
import { discoverBrandContacts, onContactDiscoveryExhausted } from '../services/contacts/contactDiscovery.service.js';
import { pollImapInbox } from '../services/email/imapInbox.js';
import { pollAllInstagramInboxes, pollInstagramInbox, refreshInstagramTokens } from '../services/instagram/instagram.service.js';

// jobType → handler. Each handler must be idempotent: a job may run more than
// once if a worker dies after doing the work but before recording success.
export const HANDLERS = {
  'discovery.run': {
    run: (job) => runDiscovery({ creatorId: job.creatorId, trigger: job.payload.trigger, jobId: job._id }),
  },
  'message.send': {
    run: (job) => deliverMessage(job.payload),
    onExhausted: (job, err) => onSendExhausted(job.payload, err),
  },
  'inbound.process': {
    run: (job) => processInboundMessage(job.payload.messageId),
    onExhausted: (job, err) => flagInboundForReview(job.payload.messageId, 'failed', `Automatic processing failed: ${err?.message || 'unknown error'}.`),
  },
  'contacts.discover': {
    run: (job) => discoverBrandContacts(job.payload.brandId),
    onExhausted: (job, err) => onContactDiscoveryExhausted(job.payload.brandId, err),
  },
  'inbound.imap_poll': {
    run: () => pollImapInbox(),
  },
  'inbound.instagram_poll': {
    run: (job) => (job.payload?.creatorId ? pollInstagramInbox(job.payload.creatorId) : pollAllInstagramInboxes()),
  },
  'maintenance.instagram_tokens': {
    run: () => refreshInstagramTokens(),
  },
  'followup.check': {
    run: (job) => runFollowUpCheck(job.payload),
  },
  'maintenance.approvals': {
    run: async () => ({ expired: await expireStaleApprovals() }),
  },
  'maintenance.deadlines': {
    run: () => scanDeadlinesAndInvoices(),
  },
};
