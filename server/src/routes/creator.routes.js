import { Router } from 'express';
import { validate, idParam } from '../middleware/validate.js';
import * as S from '../validators/schemas.js';
import { getProfile, updateProfile, updateAutonomy } from '../services/profile.service.js';
import * as discovery from '../services/discovery/discovery.service.js';
import * as opps from '../services/opportunity.service.js';
import { generatePitch, initiateOutreach } from '../services/outreach.service.js';
import { getDashboard } from '../services/dashboard.service.js';
import { NICHES, BRAND_CATEGORIES } from '../services/discovery/taxonomy.js';
import { DELIVERABLE_LABELS } from '../models/shared.js';
import { MANDATORY_APPROVAL_CATEGORIES } from '../models/CreatorProfile.js';
import { REASON_LABELS } from '../services/approvals/requirements.js';
import { BrandProfile } from '../models/index.js';
import { notFound } from '../lib/errors.js';
import { requestContactDiscovery } from '../services/contacts/contactDiscovery.service.js';
import * as instagram from '../services/instagram/instagram.service.js';

const router = Router();
const me = (req) => req.user._id;

// ---- Reference data ------------------------------------------------------------
router.get('/meta/taxonomy', (_req, res) => {
  res.json({
    niches: NICHES,
    brandCategories: BRAND_CATEGORIES,
    deliverables: Object.entries(DELIVERABLE_LABELS).map(([value, label]) => ({ value, label })),
    approvalCategories: MANDATORY_APPROVAL_CATEGORIES.map((c) => ({ value: c, label: REASON_LABELS[c] })),
  });
});

// ---- Creator profile -----------------------------------------------------------
router.get('/creator-profile/me', async (req, res) => res.json(await getProfile(me(req))));
router.patch('/creator-profile/me', validate({ body: S.profilePatchSchema }), async (req, res) => res.json(await updateProfile(me(req), req.body)));
router.patch('/settings/autonomy', validate({ body: S.autonomySchema }), async (req, res) => res.json(await updateAutonomy(me(req), req.body)));

// ---- Dashboard -----------------------------------------------------------------
router.get('/dashboard', async (req, res) => res.json(await getDashboard(me(req))));

// ---- Discovery -----------------------------------------------------------------
router.get('/discovery/status', async (req, res) => res.json(await discovery.getDiscoveryStatus(me(req))));
router.post('/discovery/start', async (req, res) => res.json(await discovery.startDiscovery(me(req))));
router.post('/discovery/pause', async (req, res) => res.json(await discovery.pauseDiscovery(me(req))));
router.post('/discovery/resume', async (req, res) => res.json(await discovery.resumeDiscovery(me(req))));
router.post('/discovery/stop', async (req, res) => res.json(await discovery.stopDiscovery(me(req))));
router.post('/discovery/run-now', async (req, res) => res.status(202).json(await discovery.runDiscoveryNow(me(req))));
router.patch('/discovery/config', validate({ body: S.discoveryConfigSchema }), async (req, res) => res.json(await discovery.updateDiscoveryConfig(me(req), req.body)));

// ---- Opportunities -------------------------------------------------------------
router.get('/opportunities', validate({ query: S.opportunityQuerySchema }), async (req, res) => res.json(await opps.listOpportunities(me(req), req.validatedQuery)));
router.get('/opportunities/:id', idParam(), async (req, res) => res.json(await opps.getOpportunity(me(req), req.params.id)));
router.post('/opportunities/:id/save', idParam(), async (req, res) => res.json(await opps.saveOpportunity(me(req), req.params.id)));
router.post('/opportunities/:id/dismiss', idParam(), async (req, res) => res.json(await opps.dismissOpportunity(me(req), req.params.id)));
router.post('/opportunities/:id/restore', idParam(), async (req, res) => res.json(await opps.restoreOpportunity(me(req), req.params.id)));
router.post('/opportunities/:id/feedback', idParam(), validate({ body: S.feedbackSchema }), async (req, res) => res.json(await opps.opportunityFeedback(me(req), req.params.id, req.body)));
router.post('/opportunities/:id/draft-pitch', idParam(), async (req, res) => res.json(await generatePitch(me(req), req.params.id)));
router.post('/opportunities/:id/instagram-pitch/draft', idParam(), async (req, res) => res.json(await instagram.draftInstagramPitch(me(req), req.params.id)));
router.post('/opportunities/:id/instagram-pitch', idParam(), validate({ body: S.instagramPitchSchema }), async (req, res) => res.status(201).json(await instagram.startInstagramPitch(me(req), req.params.id, req.body)));
router.post('/conversations/:id/instagram-pitch-sent', idParam(), async (req, res) => res.json(await instagram.markInstagramPitchSent(me(req), req.params.id)));
router.post('/opportunities/:id/initiate-outreach', idParam(), validate({ body: S.outreachSchema }), async (req, res) => res.status(201).json(await initiateOutreach(me(req), req.params.id, req.body)));
router.post('/opportunities/:id/contacts', idParam(), validate({ body: S.contactSchema }), async (req, res) => res.status(201).json(await opps.addContact(me(req), req.params.id, req.body)));
router.post('/opportunities/:id/find-contacts', idParam(), async (req, res) => res.status(202).json(await requestContactDiscovery(me(req), req.params.id)));

// ---- Brands & contacts ---------------------------------------------------------
router.get('/brands/:id', idParam(), async (req, res) => {
  const brand = await BrandProfile.findById(req.params.id).lean();
  if (!brand) throw notFound('Brand');
  res.json(brand);
});
router.patch('/contacts/:id', idParam(), validate({ body: S.contactPatchSchema }), async (req, res) => res.json(await opps.updateContact(me(req), req.params.id, req.body)));

export default router;
