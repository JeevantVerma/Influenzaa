import mongoose from 'mongoose';
import { objectId } from './shared.js';

// ---- Durable job queue -------------------------------------------------------
const scheduledJobSchema = new mongoose.Schema(
  {
    jobType: { type: String, required: true },
    creatorId: { type: objectId, ref: 'User', default: null },
    status: { type: String, enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'dead'], default: 'pending' },
    scheduledAt: { type: Date, required: true, default: Date.now },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    idempotencyKey: { type: String, required: true, unique: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    lockedBy: String,
    lockedUntil: Date,
    startedAt: Date,
    finishedAt: Date,
    lastError: String,
    result: { type: mongoose.Schema.Types.Mixed },
    cancelReason: String,
  },
  { timestamps: true },
);
scheduledJobSchema.index({ status: 1, scheduledAt: 1 });
scheduledJobSchema.index({ status: 1, lockedUntil: 1 });
scheduledJobSchema.index({ creatorId: 1, jobType: 1, status: 1 });

// ---- Worker heartbeats (used to report scheduler health honestly) -------------
const workerHeartbeatSchema = new mongoose.Schema(
  {
    workerId: { type: String, required: true, unique: true },
    host: String,
    pid: Number,
    startedAt: Date,
    lastBeatAt: { type: Date, required: true },
    jobsProcessed: { type: Number, default: 0 },
    stoppedAt: Date,
  },
  { timestamps: true },
);

// ---- Audit trail -------------------------------------------------------------
const auditEventSchema = new mongoose.Schema({
  actorType: { type: String, enum: ['creator', 'ai', 'system', 'admin', 'brand', 'worker'], required: true },
  actorId: { type: String, default: null },
  creatorId: { type: objectId, ref: 'User', default: null },
  eventType: { type: String, required: true },
  resourceType: String,
  resourceId: String,
  timestamp: { type: Date, default: Date.now },
  redactedMetadata: { type: mongoose.Schema.Types.Mixed },
});
auditEventSchema.index({ creatorId: 1, timestamp: -1 });
auditEventSchema.index({ resourceType: 1, resourceId: 1, timestamp: -1 });

// ---- Notifications -----------------------------------------------------------
const notificationSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: String,
    link: String,
    severity: { type: String, enum: ['info', 'success', 'warning', 'critical'], default: 'info' },
    dedupeKey: { type: String, required: true },
    readAt: Date,
  },
  { timestamps: true },
);
notificationSchema.index({ creatorId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ creatorId: 1, readAt: 1, createdAt: -1 });

// ---- Integration connections -------------------------------------------------
const integrationConnectionSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    provider: { type: String, enum: ['email', 'whatsapp', 'instagram'], required: true },
    status: { type: String, enum: ['connected', 'disconnected', 'degraded', 'demo', 'unavailable'], default: 'disconnected' },
    mode: { type: String, enum: ['live', 'demo', null], default: null },
    scopes: [String],
    senderDisplayName: String,
    consent: { text: String, acceptedAt: Date },
    // Provider access token, AES-GCM encrypted with ENCRYPTION_KEY (lib/crypto.js encryptSecret). Never returned by default.
    encryptedCredentialReference: { type: String, default: null, select: false },
    // Instagram professional account connected for DMs.
    instagram: {
      igUserId: String,
      appScopedId: String,
      username: String,
      accountType: String,
      connectedVia: { type: String, enum: ['login', 'token'] },
      tokenExpiresAt: Date,
      tokenRefreshedAt: Date,
      lastPolledAt: Date,
      lastSuccessAt: Date,
      // DMs older than this are never imported (set when the account is connected).
      importFrom: Date,
      brandThreads: { type: Number, default: 0 },
      // Conversations Instagram returned on the last check (0 usually means message access is off).
      lastConversationCount: Number,
    },
    connectedAt: Date,
    disconnectedAt: Date,
    lastSuccessfulSyncAt: Date,
    lastError: { message: String, at: Date },
  },
  { timestamps: true },
);
integrationConnectionSchema.index({ creatorId: 1, provider: 1 }, { unique: true });

// ---- Instagram DM threads seen by the inbox checker --------------------------
// One row per Instagram conversation. "brand" threads are linked to a
// CreatorOS conversation; "ignored" threads (fans, friends) keep only the
// thread id and timestamps, never message content or usernames.
const instagramThreadSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    igConversationId: { type: String, required: true },
    status: { type: String, enum: ['brand', 'ignored'], required: true },
    conversationId: { type: objectId, ref: 'Conversation', default: null },
    lastSeenAt: Date,
  },
  { timestamps: true },
);
instagramThreadSchema.index({ creatorId: 1, igConversationId: 1 }, { unique: true });

// ---- Inbound mailbox cursor (IMAP polling) -----------------------------------
// Where the inbox checker stopped, so each message is read once. uidValidity
// changes if the server renumbers the mailbox; the cursor then restarts at "now".
const mailboxCursorSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    uidValidity: String,
    lastUid: { type: Number, default: 0 },
    lastPolledAt: Date,
    lastSuccessAt: Date,
    lastError: String,
    matchedTotal: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// ---- Counters (invoice numbers) ----------------------------------------------
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

export const ScheduledJob = mongoose.models.ScheduledJob || mongoose.model('ScheduledJob', scheduledJobSchema);
export const WorkerHeartbeat = mongoose.models.WorkerHeartbeat || mongoose.model('WorkerHeartbeat', workerHeartbeatSchema);
export const AuditEvent = mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);
export const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
export const IntegrationConnection =
  mongoose.models.IntegrationConnection || mongoose.model('IntegrationConnection', integrationConnectionSchema);
export const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);
export const MailboxCursor = mongoose.models.MailboxCursor || mongoose.model('MailboxCursor', mailboxCursorSchema);
export const InstagramThread = mongoose.models.InstagramThread || mongoose.model('InstagramThread', instagramThreadSchema);
