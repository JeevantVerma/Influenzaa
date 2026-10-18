import mongoose from 'mongoose';
import { objectId } from './shared.js';

const invoiceSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    campaignId: { type: objectId, ref: 'Campaign', required: true },
    invoiceNumber: { type: String, required: true },
    amountMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    lineItems: [new mongoose.Schema({ description: String, amountMinor: Number }, { _id: false })],
    issueDate: Date,
    dueDate: Date,
    status: { type: String, enum: ['draft', 'issued', 'overdue', 'paid', 'cancelled'], default: 'draft' },
    paymentReference: String,
    paidAt: Date,
    // CreatorOS does not move money. A "paid" invoice is creator-reported
    // unless a configured payment provider verified it.
    paymentVerification: { type: String, enum: ['creator_reported', 'provider_verified', null], default: null },
    remindersSent: { type: Number, default: 0 },
    lastReminderAt: Date,
    notes: String,
    statusHistory: [new mongoose.Schema({ from: String, to: String, at: Date }, { _id: false })],
  },
  { timestamps: true },
);

invoiceSchema.index({ creatorId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ creatorId: 1, status: 1, dueDate: 1 });

export const Invoice = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);
