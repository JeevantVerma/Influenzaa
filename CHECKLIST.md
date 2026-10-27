# CreatorOS implementation checklist

Legend: ✅ implemented and verified (tests and/or a manual browser walkthrough) · 🟡 implemented, partially verified · ⬜ not started

Last updated: 2026-10-27

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
- ✅ One open deal per brand enforced by a unique partial index; executor checks the draft before changing deal state (tested)
- ⬜ MongoDB transactions for multi-step writes (needs a replica set in dev, tests and production)
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
- ✅ Contacts from brands' own websites: robots.txt-honouring crawler (≤8 pages), published emails only with source page, role ranking, automatic for new real brands + "Find on website" button (unit + integration tested; live-tested on real Indian D2C sites; verified in the browser)
- ✅ Real discovery sources (live-tested): GDELT news + AI brand extraction with verbatim-quote check; Serper search for brand creator programmes; Instagram via Apify (paid partnerships, disclosed collabs/discount codes, niche brand posts); creator-programme detection on brand sites; brand websites confirmed by visiting; per-niche cache
- ✅ Discovery robustness (2026-10-20): patient GDELT retries with Google News (Serper) as backup, niche rotation across runs, influencer platforms filtered by homepage, new accounts follow platform sources
- ✅ Live negotiation test with a test brand over real Gmail (2026-10-21): replies stay in one Gmail thread; brand terms carry across emails (per-item rates, fee carry-over); counters acknowledge the brand's offer and only push back on conditions that change money, timing, usage or workload; reply drafts use the creator's profile facts
- ✅ Multi-round negotiation (2026-10-21): counters come down halfway each round towards the brand's offer or the creator's minimum; a final offer at or above the minimum prepares an acceptance for approval; below it, one last counter at the minimum
- ✅ Agreement is final (2026-10-22): brand confirmations after agreement get a thank-you draft, never a counter; a brand accepting the creator's counter marks terms agreed; real changes to agreed terms go to the creator with nothing drafted
- ✅ Instagram DMs (2026-10-22): connect (token or Instagram login), inbox checked every minute, brand DMs become deals and run through the same negotiation, fans ignored and not stored, replies only inside the 24-hour window, DM pitches sent by the creator then taken over; live-tested 2026-10-27 (after publishing the Meta app): DM → deal → counters → acceptance sent through Instagram. Later: webhooks, Meta App Review + Business Verification for other creators
- 🟡 WhatsApp (2026-10-28): official Cloud API, signed webhook, brand-or-not filter (personal chats not stored), deals and the same negotiation, replies only inside 24 hours, "Continue on WhatsApp" moves a deal; tested with a fake WhatsApp, not yet against Meta. Later: templates for messages after 24 hours, Embedded Signup per creator, coexistence with the WhatsApp Business app
- ✅ `npm run db:remove-demo` removes all demo data (dry run by default); demo removed from this dev setup
- ✅ Instagram: scan posts of up to 10 similar creators listed in Settings (paid > disclosed > featured), hashtags as fallback; live-tested
- ⬜ Remove the `demo` source from real deployments

## Phase 3 — AI negotiation core
- ✅ Provider-independent AI layer: Anthropic (official SDK, structured output, refusal fallback, typed errors), dev mock, disabled
- 🟡 Gemini provider (development alternative, free tier): Interactions REST API per Google's docs, `store: false`, retries on 429/5xx, unit-tested against a fake fetch; **live smoke test passes 12/12** on `gemini-3.5-flash-lite` (classification incl. Hinglish, extraction incl. prompt injection, drafts checked against style rules); prompts tuned from reviewed real output; daily-quota fail-fast
- 🟡 Anthropic provider: implemented to the current SDK docs; schemas checked against structured-output limits; token usage logged per call; live smoke test ready (`npm run ai:smoke -w server`), not yet run (no API key)
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
- ✅ SMTP adapter: real messages sent through the app with Gmail SMTP during the live test negotiation (2026-10-20/21)
- ✅ Explicit creator authorisation for sending, with stored consent text; revocable
- ✅ Consent recorded while sending was simulated doesn't authorise real sending; the creator authorises again once a live provider is configured
- ✅ Truthful sender identity, AI-assistance disclosure and unsubscribe line on every message
- ✅ Inbound webhook with HMAC signature and timestamp; dedupe by provider message id (tested)
- ✅ Development email via your own Gmail: SMTP send + IMAP reply checker (`+cos-{token}` reply addresses, read-only, starts at now, skips own sent mail); unit-tested with a fake mailbox and used live with real Gmail (2026-10-20/21)
- ⬜ Production email: per-creator Gmail OAuth (`gmail.send`), reply copies via Cloudflare Email Routing to a CreatorOS domain, Google OAuth verification
- ✅ Webhook stores and queues only; AI and negotiation steps run in the `inbound.process` job with retry, offer-once guard, and creator review on interruption (tested)
- ✅ Thread matching by reply token or RFC 5322 headers only, never by brand name (tested)
- ✅ Bounce handling (global suppression); opt-out and refusal suppression (tested)
- ✅ Follow-ups: business-day scheduling, max attempts, stop on reply / opt-out / takeover, cancellable, suppression reason recorded
- ✅ Unified inbox: timeline with draft / queued / sent / simulated / failed labels, notes, human takeover, off-platform marker
- ✅ Demo-only reply simulator that runs the real inbound pipeline (same background job as the webhook; UI polls while analysing; verified in the browser with live Gemini)
- ✅ Integration status panel (email incl. inbound checker, AI, worker, sources, Instagram connection, WhatsApp unavailable)

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
- ✅ Integration tokens encrypted with a dedicated `ENCRYPTION_KEY` (required in production; older tokens saved under `AUTH_SECRET` still decrypt), so rotating `AUTH_SECRET` doesn't disconnect Instagram (tested, 2026-10-27)
- ✅ Dependency audit clean (`npm audit fix`: body-parser 2.4.0, fast-uri 3.1.9; 2026-10-27)
- ✅ Admin metrics endpoint (aggregate only, audit-logged); `create-admin` script
- ⬜ Error monitoring hook (Sentry or equivalent) — add a transport in `lib/logger.js` and `errorHandler.js`
- ⬜ Official WhatsApp Business adapter (needs Meta Business verification, phone number id, templates)
- 🟡 Official Instagram messaging adapter: built and live-tested in development (see Phase 2). Still needed for other creators: Meta App Review + Business Verification, Instagram login over HTTPS, webhooks instead of polling
- ⬜ Browser E2E suite (Playwright)

## Outstanding / next steps
1. **Credentials.** Run one real Anthropic extraction and draft with `ANTHROPIC_API_KEY` (`npm run ai:smoke -w server`), and check that the response format and refusal fallback work against the live API.
2. **Production email.** Per-creator Gmail OAuth (`gmail.send`) and Google OAuth verification, plus reply copies to a CreatorOS domain via Cloudflare Email Routing (see CLAUDE.md priority 5).
3. **Secrets.** Move `ENCRYPTION_KEY` (and other secrets) into a KMS or secret manager before launch.
4. **AI contract and brief review** (priority 1): extract clauses from uploaded PDFs and flag them against policy.
5. **Analytics.** Platform analytics via official APIs, to turn creator-entered metrics into verified ones.
6. **Playwright E2E** for the main browser flows; Indian public holiday calendar for follow-ups.
7. **Error monitoring** and an alerting hook for failed sends and dead jobs.
8. **Security review** before launch: dependency audit, penetration test of auth, CSRF and webhooks; DNS-rebinding-safe fetch using a pinned lookup agent.

## External access required
| Item | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude for classification, extraction and drafting (launch target; needs paid credits) |
| `GEMINI_API_KEY` | Gemini free tier, used in development until Claude credits exist |
| `SERPER_API_KEY` | Brand creator-programme search and Google News backup for discovery |
| `APIFY_TOKEN` | Instagram discovery (cost-capped by `APIFY_MAX_USD_PER_RUN`) |
| Gmail address + app password | Development email (SMTP send + IMAP replies) |
| Gmail OAuth app + Google verification, reply domain | Production email per creator |
| Meta app (published) + Instagram professional account | Instagram DMs; App Review + Business Verification for other creators |
| `BRAVE_SEARCH_API_KEY` (optional) | Brave search source |
| WhatsApp Business Platform | Post-MVP messaging channel |
