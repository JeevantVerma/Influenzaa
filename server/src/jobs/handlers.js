import { runDiscovery } from '../services/discovery/pipeline.js';
import { deliverMessage, onSendExhausted } from '../services/messaging.service.js';
import { runFollowUpCheck } from '../services/followup.service.js';
import { expireStaleApprovals } from '../services/approvals/approval.service.js';
import { scanDeadlinesAndInvoices } from '../services/campaign.service.js';

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
