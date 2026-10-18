import mongoose from 'mongoose';
import { objectId } from './shared.js';

// Outreach suppression list. creatorId null = global (e.g. hard bounce),
// otherwise scoped to one creator (opt-out or clear refusal).
const suppressionSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    creatorId: { type: objectId, ref: 'User', default: null },
    reason: { type: String, enum: ['opt_out', 'bounce', 'refusal', 'manual'], required: true },
    sourceMessageId: { type: objectId, ref: 'Message' },
    note: String,
  },
  { timestamps: true },
);

suppressionSchema.index({ email: 1, creatorId: 1 }, { unique: true });

export const Suppression = mongoose.models.Suppression || mongoose.model('Suppression', suppressionSchema);
