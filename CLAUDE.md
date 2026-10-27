# CLAUDE.md — CreatorOS

Guidance for Claude Code in this repository. **Keep this file current:** update it in the same turn as any change to commands, architecture, conventions, environment quirks, or project status.

## Absolute rules
- **Never `git commit` or `git push`.** The user does all version control manually. Read-only git commands (status, diff, log) are fine.
- Never put secrets in client code, logs, chat, or committed files. `server/.env` and `server/.demo-credentials` are gitignored. The user adds API keys to `.env` themselves.
- Never fake success: no pretending an email was sent, a payment received, or an integration connected. Demo and mock paths must stay clearly labelled.
- Approval enforcement lives on the backend. Don't weaken the invariants under "Do not break" below.

## What this is
CreatorOS is an India-first AI talent manager for independent creators. The core loop: discover sponsors → pitch → AI-assisted negotiation inside creator-set boundaries → campaign → invoice and payment tracking. The goal is a **real product launch**, not a demo.

## Current status (honest)
- **Real:** auth and security, MongoDB models, durable job queue and discovery scheduler, deterministic negotiation policy engine, approval system, inbox, campaigns and invoices, audit trail, 167 tests (163 server, 4 client).
- **Stand-ins (no credentials yet):**
  - AI runs on **Gemini** (`gemini-3.5-flash-lite`, free tier) in this dev setup: the smoke test passes 12/12 live (2026-10-19). Free-tier prompts may be used by Google, so test data only. **Claude** (launch target, needs paid credits) has still never called the live API.
  - Email in this dev setup is the user's own Gmail (SMTP send + IMAP replies with an app password, set in `server/.env`). Both logins verified 2026-10-20; a full pitch → reply → negotiation round with the test brand worked on 2026-10-20/21 (fixes from it: one Gmail thread, terms carried across emails, see below). Demo-era email consent no longer counts, so the creator re-authorises once in Settings → Integrations.
  - Discovery: only real sources in this dev setup (`DISCOVERY_SOURCES=rss,gdelt,serper,instagram`, keys in `server/.env`). Demo data was removed on 2026-10-20 with `npm run db:remove-demo -- --yes` (demo account, fictional brands, all demo opportunities) and `DEMO_FEATURES_ENABLED=false`; `npm run db:seed-demo` re-creates it (needs `demo` back in `DISCOVERY_SOURCES`). Contacts for real brands come from the website contact finder.
  - Test brand **Jeevant** (`jeevant.test`, contact `vermajeevant@gmail.com`, added 2026-10-20 with `db:add-test-brand`) is in the user's account for end-to-end testing with a friend acting as the brand; `db:remove-demo -- --yes` removes it.
  - Brand replies arrive through the IMAP inbox checker. The "Simulate brand reply" button exists only while `DEMO_FEATURES_ENABLED=true`.
- **UI:** redesign in progress (task 4). Done: new foundations (self-hosted Plus Jakarta Sans, 15px base, warm palette with fixed meanings: indigo brand, green money, amber needs-you, violet AI, mustard demo), plain-language nav (Home, Find sponsors, Inbox, Deals, Approvals), phone bottom tab bar, no horizontal page scroll, the dashboard, and (2026-10-19) opportunities list + detail, approvals (pitch review), negotiation and inbox. Pattern: `PageHead` (back link on phones), `Section`, `Disclosure` for details, main decision first, `.action-bar.sticky` keeps primary buttons above the phone tab bar, comparison tables become labelled cards on phones, chat bubbles for conversations, inbox is list-then-conversation on phones. Still admin-style: campaigns, campaign detail, settings, activity, onboarding, login. Verify UI in the browser pane at desktop (1280) and phone (375), light and dark; check `document.documentElement.scrollWidth === innerWidth`.
- **Priority list** (agreed 2026-10-19, worked top to bottom):
  1. ✅ Correctness fixes: inbound AI work moved to a job, unique open deal per brand, executor draft pre-check. **Still open:** MongoDB transactions for multi-step writes (needs a replica set locally and in tests; not decided).
  2. ✅ Real AI (2026-10-19), on **Gemini `gemini-3.5-flash-lite`** because the user has no Claude budget yet. Live smoke test 12/12; outputs reviewed and prompts tuned (`EMAIL_STYLE` in `prompts.js`: first person, no invented audience claims, Indian ₹ format, no name sign-off, no repeated amounts). Flash-Lite answers in 1-5 s; `gemini-3.8-flash` free tier is only 20 requests/day, so it is not the default. A daily-quota 429 blocks further calls until reset and the app falls back to templates. Demo simulator now uses the `inbound.process` job and the UI polls while a reply is analysed; verified end to end in the browser. Switch to Claude when credits exist (`ANTHROPIC_API_KEY` takes precedence).
  3. **Mostly done (2026-10-19).** Real discovery plus contacts. Sources (all live-tested with the user's keys):
     - `gdelt`: Indian business news (free; GDELT licence requires citation + link, shown in the evidence panel). AI (`extractBrandSignals`) lists brands with a verbatim quote; quote and core name must appear in the article. Found e.g. Milky Mist (protein milk launch). GDELT is slow (10-15 s per reply) and often answers 429 even when requests are spaced out, so it is retried after 20/30/45 s; if it stays busy, Google News results via Serper (`serperNews`, last week, India) are the article list instead, with evidence `source: 'news'` (no GDELT citation).
     - `serper`: search for brand creator/affiliate programme pages; keeps a page only if it is itself the brand's programme (drops agencies, listicles, pages about another brand's programme). Found Myprotein IN, Swolverine, DesiKoncept.
     - `instagram` (Apify `apify/instagram-scraper` + `instagram-profile-scraper`, cost-capped by `APIFY_MAX_USD_PER_RUN`). **Creator mode** (default when the user lists similar creators in Settings → Discovery, `sourceConfiguration.instagramCreators`, max 10): last 60 days of those creators' posts; signals ranked paid (`paidPartnership`) > disclosed (#ad, "ambassador", "partnered with", discount codes) > featured (tags/mentions/`coauthorProducers`). Listed creators are never treated as brands and never named in evidence. **Hashtag mode** is the fallback (live: no paid partnerships in 120 recent posts). Live creator-mode test found Myntra, Torani, Amama, Shri Paramani Jewels. Link-in-bio/app links (`REDIRECTORS` in `web.js`) are never a brand site; a business profile's own link is trusted on the brand's first word (`trustHint`).
     - Creator-programme detection inside the website crawler (`detectProgramme`), stored on `BrandProfile.creatorProgramme`, forces high intent.
     - Brand websites are confirmed by visiting them (`brandResolver.js`): hint/Serper/obvious domains, accepted only if the domain spells the brand or the homepage names it. Results are cached per niche (`DiscoveryCache`, TTL index). Rule: search/scrape results are leads; stored evidence comes from pages the app fetched itself.
     - Gemini Search grounding stays rejected (Google terms); Meta Ad Library API doesn't cover Indian commercial ads.
     - Live check: `npm run discovery:smoke -w server -- --source=gdelt,serper,instagram --niche=fitness [--creators=handle1,handle2] [--fresh]`.
     - Niches: GDELT searches 2 and Serper 3 per run, taking turns across all the creator's niches (`rotateNiches` in `taxonomy.js`, per cache window). Serper drops influencer platforms by also checking the site's homepage (`AGENCY` in `serper.source.js`).
     - New accounts store `enabledSources: []`, which means every platform source including ones added later; an explicit list can't be empty (422). Accounts created before 2026-10-20 kept a copy of the list from signup.
  4. **Core screens done (2026-10-19).** UI/UX redesign of dashboard, opportunities, opportunity detail, pitch review (approvals), negotiation and inbox. Remaining screens (campaigns, settings, activity, onboarding, login) still use the old layout but inherit the new fonts/colours.
  5. **Dev path built (2026-10-20).** Decision: platform senders (Resend, Brevo, Postmark) ban cold outreach, so production = creator's own Gmail via OAuth `gmail.send` (sensitive scope: free Google review, no CASA) + Reply-To copy to a CreatorOS reply domain via Cloudflare Email Routing (needs a domain). Reading creators' inboxes is avoided (restricted scopes need a paid CASA audit). **For development (free, single creator):** Gmail SMTP + app password to send, `EMAIL_REPLY_TO_ADDRESS=you+cos-{token}@gmail.com`, and `INBOUND_PROVIDER=imap` polls the same inbox every minute (`inbound.imap_poll` job, `services/email/imapInbox.js`): read-only, downloads only messages addressed to a reply address, starts at "now" on first run, cursor in `MailboxCursor`, skips copies of our own sent mail, feeds `receiveInbound` + `queueInboundProcessing`. Still to do for production: Gmail OAuth sending per creator, Cloudflare reply relay, Google OAuth verification.
  5b. **Instagram DMs work live end to end (2026-10-27):** a friend's DM became a deal; two counters and an acceptance were approved and sent through the Send API (stored with Instagram message ids); the deal reached `agreement_pending`. Official Instagram API with Instagram Login (graph.instagram.com, v26.0; shapes checked against Meta docs 2026-10-22). Rules it is built around: apps can't send a first DM (pitches by DM are sent by the creator: copy + `ig.me/m/<handle>` + "I've sent it"), replies only within 24 h of the brand's last DM (`instagramWindow`; sends after that fail as not sent), only the latest 20 messages per thread are readable, other creators need Meta App Review + Business Verification. Dev connection = pasting a dashboard token (encrypted, AES-GCM from `ENCRYPTION_KEY`, falling back to AUTH_SECRET in dev); production = Instagram login (`INSTAGRAM_APP_ID/SECRET/REDIRECT_URI`, HTTPS). The inbox is polled every minute (`inbound.instagram_poll`); webhooks are a later production step. Unofficial automation (private API, browser bots) is ruled out. First live test (2026-10-22): token connect and `/me` work (account `influenzaaa2`, MEDIA_CREATOR; `/me` returns `user_id` and a different app-scoped `id`, both treated as the creator's own), but `/me/conversations` returned an empty list for a friend's DM: needs "Allow access to messages" on the account and, in development mode, the sender as an Instagram Tester. The Settings card shows this hint when `lastConversationCount` is 0. `/me/subscribed_apps` was empty; connecting now also calls `POST /<IG_ID>/subscribed_apps?subscribed_fields=messages` (the dashboard's "Webhook Subscription" switch; succeeded live). Still empty after that, after switching the account to BUSINESS, with both testers accepted and `instagram_business_manage_messages` in the token's scopes; Meta's own API integration helper also lists no conversation. **Cause found (2026-10-27): the Meta app was unpublished.** After publishing (privacy policy + data-deletion links + icon, standard access only, no App Review) `/me/conversations` returned the testers' threads within minutes and the inbox checker opened a deal, read the offer and drafted a counter. **Dev setup therefore needs the Meta app published**, not just testers. Privacy policy and data-deletion texts for publishing are in `docs/meta/` (contact email is a placeholder).
  6. Launch readiness: DPDP/legal, hosting with a replica set, monitoring, billing, Playwright E2E, closed beta.
- Detailed progress is in `CHECKLIST.md`. Keep it in sync.

## Stack
- npm workspaces, **JavaScript (ESM), not TypeScript.**
- `server/`: Node 22, Express 5, Mongoose 9, Zod 4, pino, nodemailer, `@anthropic-ai/sdk`, Vitest + Supertest + mongodb-memory-server-core.
- `client/`: React 19, Vite 8, React Router 7, TanStack Query 5, react-hook-form + zod, **plain CSS** with tokens in `client/src/styles/tokens.css`. No CSS framework. Font: `@fontsource-variable/plus-jakarta-sans` (self-hosted, imported in `main.jsx`).
- Don't replace Express (e.g. with Hono), and don't add microservices.

## Commands (run from the repo root)
```bash
npm install
npm run dev            # API :4000 (with in-process worker) + Vite :5173
npm test               # server (Vitest, ephemeral mongod) + client tests
npm run lint
npm run build          # client production build → client/dist
npm run db:init        # create collections + indexes
npm run db:seed-demo   # demo creator + opportunities; creds → server/.demo-credentials
npm run db:remove-demo # dry run of removing all demo data; add `-- --yes` to remove it
npm run db:add-test-brand -- --name=Jeevant --email=friend@example.com [--creator=you@example.com]
                       # labelled test brand (isDemo, domain <name>.test, private contact) matched for every creator; emails to it are really sent
npm run db:reset-test-brand -- --name=Jeevant   # clears all conversations/deals/approvals with that test brand; match back to new
npm run worker         # standalone worker (production: RUN_WORKER_IN_PROCESS=false)
npm run ai:smoke -w server  # LIVE check of the configured provider on fixed sample emails (~12 calls); refuses without a key
                            # add `-- --show` to print every output, `-- --only=draft` to run a subset
```
- Single server test file: `cd server && npx vitest run test/integration/e2e-deal-flow.test.js`
- Preview servers: `.claude/launch.json` defines `api` (4000) and `web` (**5180**). Use `preview_start`.

## Local environment quirks
Two development machines are in use. Check which one you are on before following these notes.

### macOS, Apple Silicon
- MongoDB **6.0.18** from Homebrew (`/opt/homebrew/bin/mongod`) runs as a brew service on `127.0.0.1:27017` (standalone, not a replica set). Nothing to start manually. Tests launch their own ephemeral mongod from that binary (the "version conflict" warning is harmless). README asks for 7+; upgrade before relying on newer features.
- Node is **v25** (Homebrew). npm prints `EBADENGINE` warnings for some packages; everything still works. Production should use Node 22 or 24 LTS.
- `server/.env` exists (created 2026-10-19 from `.env.example` with a generated `AUTH_SECRET`; `FRONTEND_URL` lists 5173 and 5180). `npm run dev` serves the web app on 5173; the preview config uses 5180.
- Shell is zsh.

### Windows 11 (`C:/Users/Jeevant/Desktop/Projects/Influenzaa`)
- MongoDB **8.0.10** is installed at `C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe`, but the Windows service is **stopped**. Start it manually (in the background) before the API, with the permanent data folder: `"C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe" --dbpath C:/Users/Jeevant/.creatoros/mongo-data --bind_ip 127.0.0.1`. Tests launch their own ephemeral mongod from that binary (`test/globalSetup.js` detects it); the "version conflict" warning is harmless.
- Node is **v22**. **Port 5173 is used by an unrelated process**, so use the preview config (web on 5180); `server/.env` `FRONTEND_URL` lists both ports.
- Shell is Git Bash or PowerShell. `server/.env` is the partner's live setup (Gemini, Gmail SMTP+IMAP, Serper, Apify; duplicate keys removed and an `ENCRYPTION_KEY` added on 2026-10-27; old demo settings kept in `server/.env.demo-backup`, gitignored). The Gmail app password in it was **rejected by Gmail (535)** on 2026-10-27, so email sending and the IMAP reply checker fail until it is replaced. The file has CRLF line endings (fine for Node).
- The full server test suite takes about 3 minutes here.

### Both machines
- Python edits on source files must use `encoding='utf-8'`, because the files contain non-ASCII characters.
- `npm install <pkg>` inside a workspace folder can fail to persist. Use `npm install -w client <pkg>` (or `-w server`) from the root.

## Architecture map
| Area | Location |
|---|---|
| Env validation (refuses mock/demo in production) | `server/src/config/env.js` |
| Express app, middleware order | `server/src/app.js` (webhooks mounted before `express.json` for raw-body HMAC) |
| Auth, sessions, CSRF | `services/auth.service.js`, `middleware/auth.js` |
| Models | `server/src/models/` (money in integer **minor units**; `isDemo` flags) |
| Job queue, worker, scheduler | `server/src/jobs/` (`queue.js`, `worker.js`, `handlers.js`, `health.js`). Job types: `discovery.run`, `message.send`, `inbound.process`, `contacts.discover` (max 2 concurrent), `followup.check`, `maintenance.*` |
| Discovery | `services/discovery/` (`discovery.service.js` controls, `pipeline.js`, `sources/`, `taxonomy.js`) |
| Scoring | `services/scoring/score.js` |
| Real discovery sources | `services/discovery/sources/{gdelt,serper,instagram}.source.js` (factories with injectable fetch/reader/AI/config for tests), shared `web.js` (non-brand domains, name matching, robots-aware page reader, `cleanUrl`), `brandResolver.js`, `cache.js`, `serper.js`, `apify.js`; HTML helpers in `lib/html.js` |
| Contacts from brand websites | `services/contacts/` (`websiteContacts.js` robots.txt + extraction + crawl, pure and fetch-injectable; `contactDiscovery.service.js` job handler, triggers, `POST /opportunities/:id/find-contacts`). Brand status in `BrandProfile.contactDiscovery`. |
| Negotiation | `services/negotiation/` (`policy.js` deterministic engine, `stateMachine.js`, `negotiation.service.js` incl. inbound: `receiveInbound` stores, `queueInboundProcessing` queues it (webhook and demo simulator), `processInboundMessage` runs in the `inbound.process` job) |
| Approvals | `services/approvals/` (`requirements.js` gate rules, `approval.service.js` lifecycle, `executor.js` single execution path, `actionHash.js`) |
| Outbound and send job | `services/messaging.service.js`, `services/email/index.js` (`replyAddressFor` / `replyTokenFromAddresses` use `EMAIL_REPLY_TO_ADDRESS` template, default `reply+{token}@EMAIL_REPLY_TO_DOMAIN`) |
| Instagram DMs | `services/instagram/` (`client.js` Graph API, fetch-injectable, `setInstagramClientForTests`; `send.js` window/size checks + send, used by `messaging.service.js`; `instagram.service.js` connect/login/token, `pollInstagramInbox` (brand-or-fan via `business_inquiry` from classify, `openInboundDeal`, `linkPendingPitch`), DM pitch start/mark sent, token refresh). Models: `IntegrationConnection.instagram`, `InstagramThread`. Routes under `/integrations/instagram/*`, `/opportunities/:id/instagram-pitch*`, `/conversations/:id/instagram-pitch-sent`. |
| Inbound email | signed webhook (`routes/system.routes.js`) or IMAP polling (`services/email/imapInbox.js`, `INBOUND_PROVIDER=imap`); both end in `receiveInbound`. Status in Settings → Integrations. |
| AI layer | `services/ai/` (`index.js` facade + template fallbacks and draft checks, `tasks.js` shared prompts/schemas per task, `anthropic.provider.js`, `gemini.provider.js` (Interactions REST API, `store: false`, schema converted to type-array nullables), `mock.provider.js`, `prompts.js`, `schemas.js`). `AI_PROVIDER=auto` picks Claude, then Gemini, then mock. Each live call logs task/model/effort/latency/tokens (no content) and adds to `aiUsageTotals()` (admin metrics only) |
| Routes | `server/src/routes/*.routes.js`; Zod schemas in `server/src/validators/schemas.js` |
| Client API and hooks | `client/src/api/client.js` (CSRF header), `client/src/api/hooks.js` (`useApi`, `useAction`) |
| Client pages and components | `client/src/pages/`, `client/src/components/` |

## Do not break (covered by tests)
- Gated actions execute **only** through `executeApprovedAction`, with an `approved` record whose `actionHash` matches and whose `boundTermsVersion` equals the deal's `termsVersion`.
- A new brand offer increments `termsVersion` and supersedes pending approvals. Approving runs `pending → approved` atomically, so replays fail.
- Accepting or declining an offer always needs approval; accepting also needs `confirm: true`.
- The AI never decides commercial limits. Monetary figures in AI drafts are checked against approved amounts; on mismatch the template fallback is used.
- Untrusted content (emails, web pages) goes to the model wrapped in `<untrusted_content>`. The model has no tools.
- Opportunity dedupe is unique on `(creatorId, dedupeKey)`. Inbound dedupe is a unique `externalMessageId`. Inbound matching uses reply token or threading headers only, never brand name; reply tokens match case-insensitively (mail clients may lowercase addresses). The IMAP checker opens the mailbox read-only and never imports mail older than its first run.
- Stopping discovery cancels pending runs and future scheduling and keeps opportunities. The UI must not claim monitoring while the worker is unhealthy.
- Every email after the first in a conversation is sent as `Re: <original subject>` with `In-Reply-To` (latest email) and `References` (whole thread), so it stays in one Gmail thread (`threadSubject` + `deliverMessage` in `messaging.service.js`).
- Brand offers are cumulative: each new brand email updates only the terms it mentions (`mergeOfferTerms`); a fee carries over while the deliverables are the same or fewer, and is recomputed from per-item rates (`unit_price`) when no total is stated. Carried terms are listed in `extraction.carriedForward`; `missingTerms` drops what is now known.
- Counters step down (`counterAmount` in `policy.js`): the first anchors at the preferred rate; each later one comes down halfway from the last sent counter (`offerHistory` source `creator_counter`) towards max(brand offer, creator minimum), rounded to ₹500, never below either. When the brand calls an offer final (`final_offer` from extraction, stored as `extraction.finalOffer`): at or above the minimum → `accept`, and an acceptance approval is prepared (`createdBy: 'ai'`, still needs approval + `confirm`); below it → one last counter at the minimum, then `decline`. Acceptances fill unstated terms from the creator's defaults (`fillUnstatedTerms`).
- Once terms are agreed (`AGREED_STATES`: `terms_agreed_subject_to_formalization`, `agreement_pending`, `deal_confirmed`) nothing drafts a counter automatically (`generateCounteroffer` refuses non-creator callers). A brand reply classified `acceptance`, or an `offer` that only adds logistics (`changesAgreedTerms` false: dates, documents), is a confirmation: pending drafts are superseded and an `acknowledgement` reply is drafted for approval. An offer that changes the agreed fee/scope/rights is recorded and the creator is notified, with no draft. A brand `acceptance` of a sent counter sets `acceptedTerms` to the creator-approved `proposedTerms` and moves to `terms_agreed_subject_to_formalization`.
- An offer with unusual conditions (`escalate`) still gets a counter draft when the fee is known; those conditions always require approval. Drafts may acknowledge the brand's own offer (`brand_offer`, an allowed amount) and get the creator's profile facts (`creatorFacts`), never invented stats.
- Instagram: no DM is sent outside the 24-hour window, over 1000 bytes, or without a stored brand IGSID; the block is checked before the message is claimed, so it is shown as failed ("not sent"), never sent. Apps never send a first DM. Fan/friend threads are stored as a bare `ignored` marker (thread id + time), never content or usernames. DMs older than the connection (`instagram.importFrom`) are never imported. Brand threads are matched by Instagram thread id or the brand account the creator messaged, never by name. Instagram conversations get no automatic follow-ups. Tokens are stored encrypted and never returned by the API. Encryption uses `ENCRYPTION_KEY` (`config.tokenKeys[0]`); decryption also tries AUTH_SECRET so older tokens keep working, and rotating AUTH_SECRET never disconnects integrations. Production refuses to start without a separate `ENCRYPTION_KEY`.
- A send interrupted mid-flight (`sending`) is marked failed with unknown outcome and never re-sent. Provider failures are never shown as sent.
- Consent given while the demo email adapter was active (`IntegrationConnection.status: 'demo'`) does not authorise real sending: a live adapter needs a `connected` authorisation, so the creator re-authorises when real email is switched on.
- The inbound webhook only stores and queues (fast 202); AI and negotiation steps run in `inbound.process`. A run that threw is retried; a run left in `processing` (worker died) is marked `interrupted` and handed to the creator, never re-run. A retried run never records the same brand offer twice.
- At most one `open` deal per `(creatorId, brandId)`, enforced by a unique partial index.
- Discovered brands are never invented: news brands need a verbatim quote found in the article; every brand website is confirmed by loading it; Instagram evidence stores post links and brand handles only, never creators' usernames or profiles (non-brand profiles are cached as a bare `rejected` marker).
- Contacts are never guessed. Website contacts are only addresses literally published on the brand's own domain (or a free-mail address listed there, capped at 35% confidence), stored with `source: 'public_page'` and the page URL. robots.txt is honoured; a 5xx/unreachable robots.txt or a 401/403/429 homepage means the site is not crawled.
- `executeApprovedAction` checks the message is still a `draft` before it changes any deal state.
- Payments are only ever `creator_reported`. The app never moves money.
- Every query is scoped by `creatorId` (another creator's records return 404).

## Conventions
- Follow the existing style: ESM, 2-space indent, single quotes, comments only where intent isn't obvious.
- Validate every request body and query with Zod (`validate({ body | query })`); queries land in `req.validatedQuery` (Express 5).
- Write new services as modules in `server/src/services/`, keep route handlers thin, and throw errors from `lib/errors.js`.
- Use `returnDocument: 'after'` with `findOneAndUpdate`, not `new: true`.
- Client mutations go through `useAction` (success toast only after the server confirms). In forms, use functional `setState` updates.
- Label demo, mock and simulated data visibly in the UI.
- Shared plain-language labels live in `client/src/lib/format.js` (`SIGNAL_LABELS`, `CHECK_LABELS`, `RECOMMENDATION_LABELS`, `APPROVAL_TEXT`, `APPROVAL_STATUS`, `INTENT_LABELS`, `DELIVERY_LABELS`). Delivery labels must keep "not delivered" (demo) and "not sent" (draft) wording; a client test enforces it.
- UI copy is plain language for creators: no internal jargon (no "autonomy level", version hashes, "violation", actor types). Creator-facing activity text comes from `client/src/lib/activity.js`; internal events are hidden there.
- Colour meanings are fixed (tokens.css): `--money` for amounts and earnings, `--warning` for things that need the creator, `--ai` for AI-written content, `--demo` for demo data. Every layout must work at 375px with no horizontal scroll.
- `npm install` (npm 11) rewrites unrelated optional-peer entries in `package-lock.json`; keep only the intended additions.
- After changes, run `npm run lint`, `npm test` and `npm run build`, and fix failures before reporting.
- Default Claude model is `claude-opus-5-5` (`ANTHROPIC_MODEL`). Read the `claude-api` skill before changing SDK code.
- Default Gemini model is `gemini-3.5-flash-lite` (`GEMINI_MODEL`, checked against Google's docs 2026-10-19). Free tier: `gemini-3.8-flash` allows 20 requests/day; `gemini-3.6-flash` was unavailable on this key. Check the current Gemini docs before changing `gemini.provider.js`; don't rely on remembered API shapes.
- New AI providers implement one `run(taskSpec)` function and use `taskProvider()` from `tasks.js`, so prompts, untrusted-content wrapping and validation stay identical.
