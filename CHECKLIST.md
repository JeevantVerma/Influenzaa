# CreatorOS implementation checklist

Legend: ✅ implemented and verified (tests and/or a manual browser walkthrough) · 🟡 implemented, partially verified · ⬜ not started

Last updated: 2026-10-18

## Phase 1 — Foundation
- ✅ npm workspaces monorepo (`server`, `client`), documented commands
- ✅ Express 5 API under `/api/v1`, centralised error handling, Zod validation, operator-injection guard
- ✅ MongoDB/Mongoose models for every spec entity, with indexes and uniqueness constraints
- ✅ Startup environment validation (refuses mock/demo integrations in production)
- ✅ Auth: register, login, logout, logout-all, password reset (single-use, 30 min), change password
- ✅ Password hashing: scrypt
- ✅ Hashed server-side session tokens, rotation, and revocation
- ✅ CSRF double-submit, secure headers, CORS allowlist, request-size limits, rate limiting
- ✅ Creator onboarding in 4 steps, saved after each step; account is created at registration
- ✅ Ownership enforcement on every resource (cross-creator access returns 404; tested)
- ✅ App shell, navigation, responsive layout, design tokens, light and dark themes, accessible controls

## Phase 2 — Sponsor discovery
- ✅ Durable MongoDB scheduler and job queue: idempotency keys, leases, retries with backoff, crash recovery (tested)
- ✅ Start / pause / resume / stop / run-now; stop cancels pending runs and future scheduling (tested)
- ✅ Discovery starts stopped by default; `awaiting_configuration` until niches are set
- ✅ Worker heartbeats; the UI never claims monitoring while the worker is down (tested)
- ✅ Per-creator manual-run quota, one pending run at a time, minimum interval, per-type concurrency
- ✅ Error state after 3 consecutive failures; partial-source reporting
- ✅ Deterministic demo source (fictional `.example` brands) with progressive signal release
- 🟡 RSS/Atom brand-newsroom source with SSRF-guarded fetch (parser and guard unit-tested; no live feed fetched here)
- 🟡 Brave Search API source (implemented; needs `BRAVE_SEARCH_API_KEY` to exercise)
- ✅ Brand normalisation, evidence storage with retrieval timestamps, verified / unverified / demo labels
- ✅ Transparent weighted scoring with positive and negative factors; policy exclusions with stated reasons
- ✅ Deduplication; no re-notification for unchanged findings; dismissed opportunities stay dismissed (tested)
- ✅ Opportunities UI: ranking, filters, search, evidence panel, fit explanation, save / dismiss / restore, feedback
- ✅ Contacts: never fabricated, confidence and verification shown, manual add (private), do-not-contact

## Phase 3 — AI negotiation core
- ✅ Provider-independent AI layer: Anthropic (official SDK, structured output, refusal fallback, typed errors), dev mock, disabled
- 🟡 Anthropic provider: implemented to the current SDK docs; not called here (no API key)
- ✅ Untrusted-content isolation in prompts; no tools; Zod-validated outputs
- ✅ Structured offer extraction (mock-tested); manual offer entry when AI is unavailable
- ✅ Deterministic policy engine: rate card, package discount, rights and exclusivity premiums, barter valuation, payment terms, workload
- ✅ Counteroffer builder (targets preferred rate, never below the brand's offer) and authorised-rules check
- ✅ Negotiation state machine with validated transitions and history
- ✅ Approval requests bound to action hash and terms version; superseded on offer change; expiry; replay-safe; edit creates a new version; revoke (all tested)
- ✅ Single executor; AI paths cannot execute without an approved record (tested)
- ✅ Autonomy levels 0–3 with explicit creator confirmation; mandatory approval categories enforced on the server
- ✅ Draft safety: unapproved amounts and implied acceptance in AI drafts fall back to templates (tested)
- ✅ Negotiation workspace UI: offer summary, terms comparison, boundaries, recommendation, checks, trade-offs, approvals, history

## Phase 4 — Email and conversations
- ✅ Email adapter interface: demo (simulated), SMTP (nodemailer), disabled
- 🟡 SMTP adapter: implemented; not exercised against a real server
- ✅ Explicit creator authorisation for sending, with stored consent text; revocable
- ✅ Truthful sender identity, AI-assistance disclosure and unsubscribe line on every message
- ✅ Inbound webhook with HMAC signature and timestamp; dedupe by provider message id (tested)
- ✅ Thread matching by reply token or RFC 5322 headers only, never by brand name (tested)
- ✅ Bounce handling (global suppression); opt-out and refusal suppression (tested)
- ✅ Follow-ups: business-day scheduling, max attempts, stop on reply / opt-out / takeover, cancellable, suppression reason recorded
- ✅ Unified inbox: timeline with draft / queued / sent / simulated / failed labels, notes, human takeover, off-platform marker
- ✅ Demo-only reply simulator that runs the real inbound pipeline
- ✅ Integration status panel (email, AI, worker, sources, WhatsApp/Instagram unavailable)

## Phase 5 — Campaign operations
- ✅ Confirmed deal → campaign (idempotent); written agreement confirmation bound to the accepted-terms hash
- ✅ Deliverables, deadlines, revision tracking with over-limit alerts, publication evidence (URL required)
- ✅ Campaign stage pipeline with guards (payment received requires a paid invoice)
- ✅ Invoices: sequential numbers, draft → issued → overdue / paid / cancelled, creator-reported payments only
- ✅ Payment reminder drafts go through approval; overdue scan; deadline reminders (hourly job)
- ✅ Completion summary (deterministic; states that analytics are not included)
- ✅ Audit trail with redacted metadata; Activity page
- ✅ Dashboard with outcome metrics (pitches, positive replies, negotiations, deals won, creator-reported revenue)

## Phase 6 — Hardening and integrations
- ✅ Critical negative tests pass (8 mandatory scenarios plus extras)
- ✅ Production build, lint
- ✅ Health and readiness endpoints, graceful shutdown, separate worker process
- ✅ OpenAPI document at `/api/v1/openapi.json`
- ✅ Data export and account deletion
- ✅ Admin metrics endpoint (aggregate only, audit-logged); `create-admin` script
- ⬜ Error monitoring hook (Sentry or equivalent) — add a transport in `lib/logger.js` and `errorHandler.js`
- ⬜ Official WhatsApp Business adapter (needs Meta Business verification, phone number id, templates)
- ⬜ Official Instagram messaging adapter (needs Meta app review and an Instagram professional account)
- ⬜ Browser E2E suite (Playwright)

## Outstanding / next steps
1. **Credentials.** Run one real Anthropic extraction and draft with `ANTHROPIC_API_KEY`, and check that the response format and refusal fallback work against the live API.
2. **SMTP + inbound relay.** Configure SMTP with SPF/DKIM/DMARC, plus an inbound provider that forwards `reply+*@<domain>` to `/api/v1/webhooks/email`. A small adapter maps the provider's payload to the documented shape.
3. **Per-creator mailbox** (Gmail/Outlook OAuth). Add encrypted credential storage (AES-256-GCM with a KMS-managed key) and IMAP or Gmail push ingestion.
4. **AI contract and brief review** (priority 1): extract clauses from uploaded PDFs and flag them against policy.
5. **Analytics.** Platform analytics via official APIs, to turn creator-entered metrics into verified ones.
6. **Playwright E2E** for the main browser flows; Indian public holiday calendar for follow-ups.
7. **Error monitoring** and an alerting hook for failed sends and dead jobs.
8. **Security review** before launch: dependency audit, penetration test of auth, CSRF and webhooks; DNS-rebinding-safe fetch using a pinned lookup agent.

## External access required
| Item | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Real classification, extraction and drafting |
| SMTP account + verified sending domain | Real outbound email |
| Inbound email provider + `INBOUND_WEBHOOK_SECRET` | Receiving brand replies |
| `BRAVE_SEARCH_API_KEY` (optional) | Search-based discovery |
| Meta Business / WhatsApp Business Platform / Instagram app review | Post-MVP messaging channels |
