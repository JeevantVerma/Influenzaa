import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { useTestDatabase, clearCollectionsBeforeEach, signUp, onboard, drainWorker } from '../helpers.js';
import { DevOutboxEmail } from '../../src/services/email/index.js';
import { User } from '../../src/models/index.js';

const ctx = useTestDatabase();
clearCollectionsBeforeEach();

describe('authentication', () => {
  it('registers, reads the session, and logs out', async () => {
    const c = await signUp(ctx.app);
    const me = await c.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(c.email);
    expect(me.body.user.passwordHash).toBeUndefined();
    const out = await c.post('/auth/logout');
    expect(out.status).toBe(204);
    expect((await c.get('/creator-profile/me')).status).toBe(401);
  });

  it('stores only a hashed password and rejects a wrong password', async () => {
    const c = await signUp(ctx.app);
    const u = await User.findOne({ email: c.email }).select('+passwordHash').lean();
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    const bad = await request(ctx.app).post('/api/v1/auth/login').send({ email: c.email, password: 'wrong-password-123' });
    expect(bad.status).toBe(401);
    const good = await request(ctx.app).post('/api/v1/auth/login').send({ email: c.email, password: 'correct-horse-battery' });
    expect(good.status).toBe(200);
    expect(good.headers['set-cookie'].join(';')).toMatch(/cos_session=.*HttpOnly/i);
  });

  it('rejects duplicate registration and validates input', async () => {
    const c = await signUp(ctx.app);
    const dup = await request(ctx.app).post('/api/v1/auth/register').send({ name: 'X', email: c.email, password: 'another-password-1' });
    expect(dup.status).toBe(409);
    const weak = await request(ctx.app).post('/api/v1/auth/register').send({ name: 'X', email: 'x@example.com', password: 'short' });
    expect(weak.status).toBe(422);
  });

  it('requires a CSRF token for state-changing requests', async () => {
    const c = await signUp(ctx.app);
    const res = await c.agent.patch('/api/v1/creator-profile/me').send({ bio: 'hello' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/);
    expect((await c.patch('/creator-profile/me', { bio: 'hello' })).status).toBe(200);
  });

  it('rejects MongoDB operator injection', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    expect([400, 422]).toContain(res.status);
  });

  it('resets a password through the (demo) outbox and revokes old sessions', async () => {
    const c = await signUp(ctx.app);
    await request(ctx.app).post('/api/v1/auth/forgot-password').send({ email: c.email }).expect(200);
    const mail = await DevOutboxEmail.findOne({ to: c.email }).lean();
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)[1]);
    await request(ctx.app).post('/api/v1/auth/reset-password').send({ token, password: 'brand-new-password-1' }).expect(200);
    expect((await c.get('/creator-profile/me')).status).toBe(401); // old session revoked
    await request(ctx.app).post('/api/v1/auth/login').send({ email: c.email, password: 'brand-new-password-1' }).expect(200);
    // token is single use
    await request(ctx.app).post('/api/v1/auth/reset-password').send({ token, password: 'another-password-2' }).expect(400);
  });

  it('does not reveal whether an email is registered', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
  });
});

describe('ownership enforcement', () => {
  it('a creator cannot read or act on another creator’s records', async () => {
    const a = await signUp(ctx.app);
    const b = await signUp(ctx.app);
    await onboard(a);
    await a.post('/discovery/run-now').expect(202);
    await drainWorker();
    const list = await a.get('/opportunities');
    expect(list.body.items.length).toBeGreaterThan(0);
    const oppId = list.body.items[0]._id;

    expect((await b.get(`/opportunities/${oppId}`)).status).toBe(404);
    expect((await b.post(`/opportunities/${oppId}/dismiss`)).status).toBe(404);
    expect((await b.post(`/opportunities/${oppId}/draft-pitch`)).status).toBe(404);
    expect((await b.get('/opportunities')).body.items).toHaveLength(0);

    const pitch = await a.post(`/opportunities/${oppId}/draft-pitch`);
    const opp = (await a.get(`/opportunities/${oppId}`)).body;
    const contact = opp.contacts.find((x) => x.businessEmail);
    if (contact) {
      const out = await a.post(`/opportunities/${oppId}/initiate-outreach`, { contactId: contact._id, subject: pitch.body.subject, body: pitch.body.body });
      expect(out.status).toBe(201);
      expect((await b.get(`/conversations/${out.body.conversationId}`)).status).toBe(404);
      expect((await b.get(`/negotiations/${out.body.dealId}`)).status).toBe(404);
      expect((await b.get(`/approvals/${out.body.approvalId}`)).status).toBe(404);
      const approval = (await a.get(`/approvals/${out.body.approvalId}`)).body;
      expect((await b.post(`/approvals/${out.body.approvalId}/approve`, { actionHash: approval.actionHash })).status).toBe(404);
    }
  });

  it('returns 404 for malformed ids rather than leaking errors', async () => {
    const a = await signUp(ctx.app);
    expect((await a.get('/opportunities/not-an-id')).status).toBe(404);
  });
});
