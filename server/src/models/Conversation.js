import mongoose from 'mongoose';
import { objectId } from './shared.js';

const conversationSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    brandId: { type: objectId, ref: 'BrandProfile', required: true },
    opportunityId: { type: objectId, ref: 'Opportunity' },
    dealId: { type: objectId, ref: 'Deal' },
    contactId: { type: objectId, ref: 'BrandContact' },
    channel: { type: String, enum: ['email', 'whatsapp', 'instagram', 'manual'], default: 'email' },
    externalThreadId: { type: String, default: null },
    // Opaque token used in the platform reply-to address (reply+<token>@domain)
    // so inbound replies are matched to exactly one conversation.
    replyToken: { type: String, required: true, unique: true },
    // Code in a "Continue on WhatsApp" link; the brand's first WhatsApp message carries it, which moves this deal to WhatsApp.
    waRef: { type: String, default: undefined },
    subject: String,
    participants: [
      new mongoose.Schema(
        // Instagram: instagramId is the brand's Instagram-scoped id (IGSID) used to reply; username is its handle.
        { name: String, email: String, role: String, side: { type: String, enum: ['creator', 'brand'] }, instagramId: String, username: String, waId: String },
        { _id: false },
      ),
    ],
    status: { type: String, enum: ['open', 'closed', 'moved_offplatform'], default: 'open' },
    offPlatformChannel: String,
    humanTakeover: { type: Boolean, default: false },
    lastMessageAt: Date,
    lastInboundAt: Date,
    lastOutboundAt: Date,
    nextFollowUpAt: { type: Date, default: null },
    followUpCount: { type: Number, default: 0 },
    followUpSuppressedReason: String,
    unreadInbound: { type: Number, default: 0 },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

conversationSchema.index({ creatorId: 1, lastMessageAt: -1 });
conversationSchema.index({ creatorId: 1, dealId: 1 });
conversationSchema.index({ externalThreadId: 1 }, { sparse: true });
conversationSchema.index({ waRef: 1 }, { unique: true, sparse: true });

export const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
