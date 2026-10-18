import mongoose from 'mongoose';

// Server-side sessions. Only a SHA-256 hash of the opaque session token is
// stored, so a database leak does not expose usable session cookies.
const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: String,
    lastSeenAt: Date,
    userAgent: { type: String, maxlength: 300 },
  },
  { timestamps: true },
);

// Expired sessions are removed automatically by MongoDB.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
