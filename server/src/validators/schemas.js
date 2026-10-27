import { z } from 'zod';
import { DELIVERABLE_TYPES } from '../models/shared.js';
import { SUPPORTED_CURRENCIES } from '../lib/money.js';
import { ONBOARDING_STEPS, MANDATORY_APPROVAL_CATEGORIES } from '../models/CreatorProfile.js';
import { NICHES, BRAND_CATEGORIES } from '../services/discovery/taxonomy.js';

const s = (max = 200) => z.string().trim().max(max);
const strList = (max = 30, len = 80) => z.array(s(len)).max(max);
const minor = z.number().int().min(0).max(10_000_000_000);
const url = z.string().trim().url().max(2048).refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL');

export const registerSchema = z.object({
  name: s(120).min(1, 'Name is required'),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) });
export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(10).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) });

const rate = z
  .object({ deliverable: z.enum(DELIVERABLE_TYPES), preferredMinor: minor, minimumMinor: minor })
  .refine((r) => r.minimumMinor <= r.preferredMinor, { message: 'Minimum rate cannot exceed the preferred rate' });

export const profilePatchSchema = z
  .object({
    publicName: s(120),
    bio: s(2000),
    country: s(80),
    city: s(80),
    languages: strList(10, 40),
    creatorType: z.enum(['individual', 'duo_group', 'channel_brand', 'expert_professional']).nullable(),
    platformProfiles: z
      .array(
        z.object({
          platform: z.enum(['instagram', 'youtube', 'linkedin', 'x', 'facebook', 'snapchat', 'moj', 'josh', 'sharechat', 'podcast', 'blog', 'other']),
          handle: s(100).optional(),
          url: url.optional().or(z.literal('')),
          followers: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
        }),
      )
      .max(12),
    niches: z.array(z.enum(NICHES)).max(8),
    contentFormats: strList(12, 60),
    audienceMetrics: z
      .object({
        ageRanges: strList(8, 20),
        genderSplit: s(100),
        topLocations: strList(10, 60),
        avgViews: z.number().int().min(0).max(1_000_000_000).nullable(),
        engagementRatePercent: z.number().min(0).max(100).nullable(),
        postingFrequency: s(60),
      })
      .partial(),
    mediaKitUrl: url.or(z.literal('')),
    brandPreferences: z
      .object({
        preferredCategories: z.array(z.enum(BRAND_CATEGORIES)).max(20),
        prohibitedCategories: z.array(z.enum(BRAND_CATEGORIES)).max(20),
        preferredBrands: strList(30, 80),
        avoidBrands: strList(50, 80),
      })
      .partial(),
    barterPolicy: z
      .object({ acceptance: z.enum(['never', 'selective', 'open']), minimumValueMinor: minor.nullable(), approvedCategories: z.array(z.enum(BRAND_CATEGORIES)).max(20) })
      .partial(),
    commercialPolicy: z
      .object({
        currency: z.enum(SUPPORTED_CURRENCIES),
        minimumDealMinor: minor.nullable(),
        preferredDealMinor: minor.nullable(),
        rates: z.array(rate).max(DELIVERABLE_TYPES.length),
        acceptedDeliverables: z.array(z.enum(DELIVERABLE_TYPES)).max(DELIVERABLE_TYPES.length),
        maxPackageDiscountPercent: z.number().int().min(0).max(50),
        maxRevisions: z.number().int().min(0).max(10),
        usageRights: z
          .object({ organicRepostAllowed: z.boolean(), maxUsageDays: z.number().int().min(0).max(3650), paidAdsAllowed: z.boolean(), whitelistingAllowed: z.boolean(), perpetualAllowed: z.boolean() })
          .partial(),
        exclusivity: z.object({ acceptable: z.boolean(), maxDays: z.number().int().min(0).max(730) }).partial(),
        paymentTerms: z.object({ maxNetDays: z.number().int().min(0).max(180), minAdvancePercent: z.number().int().min(0).max(100) }).partial(),
        cancellationPolicy: s(1000),
        workload: z.object({ maxActiveCampaigns: z.number().int().min(1).max(50), minLeadTimeDays: z.number().int().min(0).max(90) }).partial(),
        collaborationChannels: strList(6, 40),
        paymentPreferences: s(300),
      })
      .partial(),
    automation: z
      .object({
        outreachChannels: z.array(z.enum(['email'])).max(1),
        followUps: z.object({ enabled: z.boolean(), maxAttempts: z.number().int().min(0).max(5), intervalBusinessDays: z.number().int().min(1).max(30) }).partial(),
      })
      .partial(),
    approvalPolicy: z
      .object({ additionalCategories: z.array(z.enum(MANDATORY_APPROVAL_CATEGORIES)).max(20), approvalExpiryHours: z.number().int().min(1).max(720) })
      .partial(),
    notifications: z.object({ inApp: z.boolean(), emailDigest: z.boolean(), newOpportunities: z.boolean(), approvals: z.boolean(), deadlines: z.boolean() }).partial(),
    completeStep: z.enum(ONBOARDING_STEPS),
  })
  .partial()
  .strict();

export const autonomySchema = z
  .object({
    level: z.number().int().min(0).max(3),
    autoSendPitches: z.boolean(),
    autoSendFollowUps: z.boolean(),
    confirm: z.literal(true, { message: 'Explicit confirmation is required to change automation permissions' }),
  })
  .partial({ autoSendPitches: true, autoSendFollowUps: true, level: true })
  .strict();

export const discoveryConfigSchema = z
  .object({
    intervalMinutes: z.number().int().min(1).max(60 * 24 * 30),
    enabledSources: z.array(z.enum(['demo', 'rss', 'brave', 'gdelt', 'serper', 'instagram'])).min(1, 'Keep at least one source on').max(6),
    rssFeeds: z.array(z.object({ url, brandName: s(120).optional(), brandDomain: s(253).optional(), categories: z.array(z.enum(BRAND_CATEGORIES)).max(5).optional() })).max(10),
    searchQueries: strList(3, 120),
    instagramCreators: z.array(z.string().trim().min(1).max(100)).max(10),
  })
  .partial()
  .strict();

export const opportunityQuerySchema = z.object({
  status: z.enum(['new', 'saved', 'dismissed', 'outreach_drafted', 'contacted', 'in_negotiation', 'won', 'lost', 'archived', 'active', 'all', 'excluded']).default('active'),
  signal: z.enum(['high_intent', 'medium_intent', 'low_intent']).optional(),
  verification: z.enum(['verified', 'partially_verified', 'unverified', 'demo', 'stale']).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  q: s(100).optional(),
  sort: z.enum(['score', 'recent', 'timing']).default('score'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const feedbackSchema = z.object({ rating: z.enum(['relevant', 'not_relevant']), note: s(500).optional() }).strict();
export const outreachSchema = z.object({ contactId: z.string().regex(/^[a-f0-9]{24}$/i), subject: s(200).min(1), body: z.string().trim().min(20).max(6000) }).strict();
export const contactSchema = z
  .object({
    name: s(120).nullable().optional(),
    role: s(120).nullable().optional(),
    roleCategory: z.enum(['creator_partnerships', 'brand_marketing', 'agency', 'general_partnerships', 'unknown']).optional(),
    businessEmail: z.string().trim().toLowerCase().email().max(254),
    professionalProfileUrl: url.optional(),
    sourceUrl: url.optional(),
  })
  .strict();
export const contactPatchSchema = z
  .object({ doNotContact: z.boolean().optional(), name: s(120).nullable().optional(), role: s(120).nullable().optional() })
  .strict();

const termsInput = z
  .object({
    paymentType: z.enum(['paid', 'barter', 'hybrid']).nullable(),
    totalAmountMinor: minor.nullable(),
    currency: z.enum(SUPPORTED_CURRENCIES),
    deliverables: z.array(z.object({ type: z.enum([...DELIVERABLE_TYPES, 'other']), quantity: z.number().int().min(1).max(50), description: s(300).nullable().optional() })).max(20),
    barter: z.object({ productDescription: s(300).nullable(), claimedRetailValueMinor: minor.nullable() }).partial(),
    revisionsIncluded: z.number().int().min(0).max(20).nullable(),
    usageRights: z.object({ durationDays: z.number().int().min(0).max(36500).nullable(), paidAds: z.boolean().nullable(), whitelisting: z.boolean().nullable(), perpetual: z.boolean().nullable() }).partial(),
    exclusivity: z.object({ required: z.boolean().nullable(), durationDays: z.number().int().min(0).max(3650).nullable(), scope: s(300).nullable() }).partial(),
    paymentTerms: z.object({ netDays: z.number().int().min(0).max(365).nullable(), advancePercent: z.number().min(0).max(100).nullable() }).partial(),
    deadlines: z.object({ contentDueAt: z.coerce.date().nullable(), publishAt: z.coerce.date().nullable() }).partial(),
    otherConditions: strList(10, 300),
  })
  .partial();
export const manualOfferSchema = z.object({ terms: termsInput }).strict();
export const acceptSchema = z.object({ termsVersion: z.number().int().min(0) }).strict();
export const declineSchema = z.object({ reason: s(300).optional() }).strict();
export const confirmAgreementSchema = z
  .object({ kind: z.enum(['email_confirmation', 'signed_contract', 'purchase_order', 'other']), reference: s(200).optional(), url: url.optional(), confirm: z.literal(true), acceptedTermsHash: z.string().length(64) })
  .strict();
export const closeDealSchema = z.object({ reason: s(300).optional() }).strict();

export const approveSchema = z.object({ actionHash: z.string().length(64), confirm: z.boolean().optional() }).strict();
export const rejectSchema = z.object({ note: s(500).optional() }).strict();
export const editApprovalSchema = z
  .object({ subject: s(200).min(1).optional(), content: z.string().trim().min(10).max(8000).optional(), totalAmountMinor: minor.optional() })
  .strict();

export const sendMessageSchema = z.object({ subject: s(200).min(1), content: z.string().trim().min(5).max(8000), confirm: z.literal(true) }).strict();
export const draftResponseSchema = z.object({ kind: z.enum(['clarification', 'info_reply', 'follow_up']).optional() }).strict();
export const noteSchema = z.object({ content: z.string().trim().min(1).max(5000) }).strict();
export const takeoverSchema = z.object({ enabled: z.boolean() }).strict();
export const offPlatformSchema = z.object({ channel: z.enum(['phone', 'whatsapp', 'instagram', 'in_person', 'other']), note: s(500).optional() }).strict();
export const simulateInboundSchema = z.object({ text: z.string().trim().min(1).max(10_000), subject: s(200).optional() }).strict();

export const campaignStageSchema = z.object({ stage: z.string().min(1).max(60) }).strict();
export const campaignPatchSchema = z
  .object({
    brief: z.object({ text: z.string().max(20_000), mandatoryDisclosures: strList(10, 200) }).partial().optional(),
    productShipment: z.object({ status: z.enum(['not_applicable', 'pending', 'shipped', 'received']), notes: s(300).optional() }).optional(),
    deadlines: z.object({ contentDueAt: z.coerce.date().nullable(), publishAt: z.coerce.date().nullable() }).partial().optional(),
  })
  .strict();
export const deliverableSchema = z
  .object({ type: z.enum([...DELIVERABLE_TYPES, 'other']), description: s(300).optional(), dueAt: z.coerce.date().optional(), publishAt: z.coerce.date().optional(), revisionsAllowed: z.number().int().min(0).max(20).optional() })
  .strict();
export const deliverablePatchSchema = z
  .object({
    status: z.enum(['pending', 'in_production', 'draft_submitted', 'revision_requested', 'approved', 'published']).optional(),
    dueAt: z.coerce.date().nullable().optional(),
    publishAt: z.coerce.date().nullable().optional(),
    publishedUrl: url.optional(),
    notes: s(1000).optional(),
    description: s(300).optional(),
  })
  .strict();
export const invoiceCreateSchema = z.object({ amountMinor: minor.optional(), dueInDays: z.number().int().min(0).max(180).optional(), notes: s(1000).optional() }).strict();
export const invoiceStatusSchema = z.object({ status: z.enum(['issued', 'paid', 'overdue', 'cancelled']), paymentReference: s(200).optional(), confirm: z.boolean().optional() }).strict();

export const emailConnectSchema = z.object({ consent: z.literal(true, { message: 'You must authorise CreatorOS to send email on your behalf' }), senderDisplayName: s(120).optional() }).strict();
export const instagramTokenSchema = z.object({ accessToken: z.string().trim().min(20).max(1000), consent: z.literal(true, { message: 'You must authorise CreatorOS to read and reply to brand DMs' }) }).strict();
export const whatsappTokenSchema = z.object({ phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, 'Phone number ID is a long number from the WhatsApp API setup page'), accessToken: z.string().trim().min(20).max(2000), consent: z.literal(true, { message: 'You must authorise CreatorOS to receive and reply to brand messages' }) }).strict();
export const instagramPitchSchema = z.object({ body: z.string().trim().min(10).max(2000) }).strict();
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(200), confirm: z.literal(true) }).strict();
