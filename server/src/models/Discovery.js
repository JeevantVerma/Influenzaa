import mongoose from 'mongoose';
import { objectId } from './shared.js';

export const DISCOVERY_STATES = ['stopped', 'running', 'paused', 'error', 'awaiting_configuration'];

const discoveryConfigurationSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true, unique: true },
    status: { type: String, enum: DISCOVERY_STATES, default: 'stopped' },
    intervalMinutes: { type: Number, required: true, min: 1 },
    sourceConfiguration: {
      enabledSources: [String],
      rssFeeds: [
        new mongoose.Schema(
          { url: { type: String, required: true }, brandName: String, brandDomain: String, categories: [String] },
          { _id: false },
        ),
      ],
      searchQueries: [String],
    },
    lastRunAt: Date,
    nextRunAt: { type: Date, default: null },
    lastSuccessfulRunAt: Date,
    lastError: { message: String, at: Date },
    consecutiveFailures: { type: Number, default: 0 },
    manualRunTimestamps: [Date],
    startedAt: Date,
    pausedAt: Date,
    stoppedAt: Date,
  },
  { timestamps: true },
);

discoveryConfigurationSchema.index({ status: 1, nextRunAt: 1 });

const discoveryRunSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    trigger: { type: String, enum: ['scheduled', 'manual'], required: true },
    status: { type: String, enum: ['running', 'succeeded', 'partial', 'failed', 'skipped', 'cancelled'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    sourcesQueried: [
      new mongoose.Schema(
        { source: String, status: { type: String, enum: ['ok', 'unavailable', 'error', 'skipped'] }, itemCount: Number, message: String },
        { _id: false },
      ),
    ],
    candidatesFound: { type: Number, default: 0 },
    opportunitiesCreated: { type: Number, default: 0 },
    opportunitiesUpdated: { type: Number, default: 0 },
    excludedByPolicy: { type: Number, default: 0 },
    notificationsSent: { type: Number, default: 0 },
    runErrors: [String],
    jobId: { type: objectId, ref: 'ScheduledJob' },
  },
  { timestamps: true },
);

discoveryRunSchema.index({ creatorId: 1, startedAt: -1 });

export const DiscoveryConfiguration =
  mongoose.models.DiscoveryConfiguration || mongoose.model('DiscoveryConfiguration', discoveryConfigurationSchema);
export const DiscoveryRun = mongoose.models.DiscoveryRun || mongoose.model('DiscoveryRun', discoveryRunSchema);
