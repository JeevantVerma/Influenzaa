# CreatorOS

An India-first AI talent manager for independent creators. CreatorOS keeps looking for sponsors in the background, explains with evidence why each brand looks relevant now, drafts outreach, negotiates inside the boundaries the creator sets, and runs confirmed deals through to invoice and payment tracking.

The core rule is enforced on the server: **nothing binding or outbound is executed without a valid approval record**, except for actions the creator explicitly allowed through their autonomy settings. Approvals are bound to the exact message and terms version the creator reviewed.

> Working title. Status: MVP with a production-minded architecture. See [CHECKLIST.md](CHECKLIST.md) for what is done and what is left.

---

## Contents

1. [Set up and run](#1-set-up-and-run)
2. [Connect real services](#2-connect-real-services) (AI, Gmail, discovery, Instagram)
3. [Test everything](#3-test-everything) (automated tests, live checks, hands-on walkthroughs)
4. [Command reference](#4-command-reference)
5. [Troubleshooting](#5-troubleshooting)
6. [How it works](#architecture) (architecture, negotiation, email, Instagram, environment variables, deployment)

---

## 1. Set up and run

### Prerequisites
- **Node.js 22 or 24** (LTS). Newer versions work but print `EBADENGINE` warnings.
- **MongoDB 6+** running locally (7+ recommended).
  - macOS (Homebrew): `brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`
  - Windows: start the installed service (`net start MongoDB`, as administrator) or run `mongod --dbpath ./.mongo-data`.
  - Or a free MongoDB Atlas cluster: put its connection string in `MONGODB_URI`.

### First run

1. Install dependencies (from the repo root):
   ```bash
   npm install
   ```
2. Create the server config:
   ```bash
   cp server/.env.example server/.env
   ```
3. Generate a secret and put it in `AUTH_SECRET` in `server/.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
4. Start the API (with its background worker) and the web app:
   ```bash
   npm run dev
   ```
5. Open **http://localhost:5173**, create an account, and finish onboarding (niches, rates, preferences).

- API: http://localhost:4000/api/v1 (`/health`, `/ready`, `/openapi.json`). Vite proxies `/api` to it, so cookies stay same-origin.
- Collections and indexes are created on startup (`npm run db:init` does it explicitly).
- With only the steps above, CreatorOS runs in **development mode**: AI is a rule-based mock, emails are recorded as "simulated" (never delivered), and discovery uses a fictional demo dataset. Everything is labelled. Section 2 switches each part to the real thing.

### Optional: demo data

A ready-made demo creator with brands and matches (needs `demo` in `DISCOVERY_SOURCES`):
```bash
npm run db:seed-demo
```
It prints a generated password and saves it to `server/.demo-credentials` (gitignored). To remove all demo data again, dry run first, then confirm:
```bash
npm run db:remove-demo
npm run db:remove-demo -- --yes
```

---

## 2. Connect real services

All keys go in `server/.env`. Restart `npm run dev` after editing it. Settings → Integrations shows the state of each service.

### AI (Gemini, free)
1. Create a key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Set `GEMINI_API_KEY=...` (leave `AI_PROVIDER=auto`).
3. Check it: `npm run ai:smoke -w server` (about 12 small live calls).

Free-tier prompts may be used by Google, so test with test data only. For production, set `ANTHROPIC_API_KEY` (Claude takes precedence when both are set).

### Email with your own Gmail (free, development)
Sends from your Gmail and picks up brand replies from the same inbox.
1. Turn on 2-Step Verification on the Google account, then create an app password at https://myaccount.google.com/apppasswords.
2. In `server/.env`, uncomment the Gmail block (under "Development: send and receive with your own Gmail"), replace `you@gmail.com` everywhere and paste the 16-character app password into `SMTP_PASS` (no spaces).
3. Restart, then in **Settings → Integrations → Email outreach** tick the consent box and click **Authorise email sending**.

Replies go to `you+cos-<token>@gmail.com`. CreatorOS checks the inbox every minute, read-only, and only downloads mail sent to such an address. Production plan: each creator's own Gmail via OAuth plus a reply domain.

### Real sponsor discovery
1. Set the sources: `DISCOVERY_SOURCES=rss,gdelt,serper,instagram` (add `demo` only if you want fictional brands too).
2. Keys:
   - `SERPER_API_KEY` from [serper.dev](https://serper.dev) (2,500 free searches): brand creator programmes, plus a backup when GDELT news is busy.
   - `APIFY_TOKEN` from [Apify](https://console.apify.com/settings/integrations) ($5 free credit a month): Instagram posts. `APIFY_MAX_USD_PER_RUN` caps each scrape (default $0.50).
   - GDELT news needs no key, but needs an AI key to read articles.
3. In the app: **Find sponsors → Turn on discovery**, then **Search now**. For the strongest Instagram leads, list similar creators in **Settings → Discovery**.
4. Live check without the app: `npm run discovery:smoke -w server -- --source=gdelt,serper,instagram --niche=fitness`.

### Instagram DMs
Reads brand DMs on a creator's Instagram professional account and replies through the official API. Full setup (free):
1. **Instagram (on the phone):** make the account professional (Settings → Account type and tools → Switch to professional, Creator or Business), then turn on Settings → Messages and story replies → Message controls → Connected tools → **Allow access to messages**.
2. **Meta app:** at [developers.facebook.com](https://developers.facebook.com/apps) → **Create app** → use case "Manage messaging and content on Instagram" (or Other → Business) → add **Instagram**.
3. **Testers:** App roles → Roles → **Add people → Instagram Tester** for your account and anyone who will message you while testing. Each accepts at instagram.com → Settings → Apps and websites → **Tester invites**.
4. **Token:** Instagram → API setup with Instagram login → **Add account** → **Generate token**.
5. **Publish the Meta app.** Without this, Instagram shares no conversations with the app, even for testers. In App settings → Basic add a privacy policy URL, a data-deletion instructions URL, an icon (1024×1024) and a category, then click **Publish**. Ready-made texts and an icon are in [`docs/meta/`](docs/meta/): put the two pages online (e.g. Google Docs → File → Share → Publish to web) and fill in your contact email first. This does not need App Review.
6. **CreatorOS:** Settings → Integrations → **Instagram DMs** → tick the consent box, paste the token, **Connect with token**. Keep the token out of screenshots and chats: anyone with it can read and send DMs as you.

No `.env` changes are needed for this. `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` and `INSTAGRAM_REDIRECT_URI` (HTTPS) are only for the "Connect with Instagram" login button in production. Connecting other creators' accounts needs Meta App Review for `instagram_business_manage_messages` plus Business Verification.

---

## 3. Test everything

### Automated tests (no keys needed)
```bash
npm test        # 159 server + 4 client tests; starts its own throwaway MongoDB
npm run lint
npm run build
```
Run one server file: `cd server && npx vitest run test/integration/instagram.test.js`. Tests never call real services: AI, email and Instagram are replaced by fakes.

### Live checks (use your real keys)
| Check | Command | What it proves |
|---|---|---|
| AI | `npm run ai:smoke -w server` | Classification, offer extraction (incl. a prompt-injection case), pitch and negotiation drafts on fixed fictional emails. `-- --show` prints the outputs. |
| Discovery | `npm run discovery:smoke -w server -- --source=gdelt,serper,instagram --niche=beauty` | Each source finds real brands; add `--creators=handle1,handle2` for Instagram creator mode, `--fresh` to skip the cache. |
| Gmail | Settings → Integrations → Email outreach | Shows "Last checked … replies picked up" once the inbox checker logs in. |
| Instagram | Settings → Integrations → Instagram DMs → **Check DMs now** | Shows how many brand conversations were found, or a hint if Instagram shares none. |

### Hands-on walkthrough 1: email negotiation with a friend
1. Add a labelled test brand whose contact is an inbox you or a friend control. It matches every creator, whatever the niches:
   ```bash
   npm run db:add-test-brand -- --name=Jeevant --email=friend@example.com
   ```
2. **Find sponsors → Jeevant → Draft a pitch**, review it, and approve it in **Approvals**. The email really goes out from your Gmail.
3. The friend **replies** (keep the subject) with an offer, e.g. "We can do ₹8,000 for one reel." Within a minute it appears in **Inbox**, the offer is read, and a counter is drafted for your approval.
4. Keep going: each round the counter comes down halfway towards their offer (never below your minimum). If they say an offer is final and it meets your minimum, an acceptance is prepared for your approval. After agreement, "deal done" replies get a thank-you draft, never another counter.
5. Everything stays in one Gmail thread. To start over:
   ```bash
   npm run db:reset-test-brand -- --name=Jeevant
   ```

### Hands-on walkthrough 2: Instagram DMs with a friend
Needs the Instagram setup above, with the friend added as an Instagram Tester.
1. The friend DMs your account, e.g. "Hi, we'd like a paid reel collab, budget ₹10,000."
2. Within a minute (or **Check DMs now**) it becomes a deal in **Inbox** (marked **DM**) and a short counter is drafted. Messages from non-brands are skipped and not stored.
3. Approve it in **Approvals**: it is sent as a DM. The conversation shows until when you can reply (Instagram's 24-hour window).
4. Pitching by DM: on a brand with a known Instagram handle, choose **Instagram DM**, draft, **Copy and open Instagram**, send it yourself, then **I've sent it**. CreatorOS takes over when they reply.

### Checking the UI
Look at each screen at desktop width and on a phone (375px), in light and dark mode: Home, Find sponsors, a brand page, Inbox, Deals, Approvals, Settings.

---

## 4. Command reference

| Command (repo root) | What it does |
|---|---|
| `npm run dev` | API on :4000 (with the background worker) + web app on :5173 |
| `npm run dev:api` / `npm run dev:web` | Only one of the two |
| `npm test` / `npm run lint` / `npm run build` | Tests, lint, production build of the web app (`client/dist`) |
| `npm start` / `npm run worker` | Production API / standalone worker |
| `npm run db:init` | Create collections and indexes |
| `npm run db:seed-demo` / `npm run db:remove-demo [-- --yes]` | Add / remove demo data |
| `npm run db:add-test-brand -- --name=X --email=Y [--creator=you@example.com]` | Labelled test brand for real end-to-end tests |
| `npm run db:reset-test-brand -- --name=X` | Clear all conversations with that test brand |
| `npm run ai:smoke -w server [-- --show] [-- --only=draft]` | Live AI check |
| `npm run discovery:smoke -w server -- --source=… --niche=…` | Live discovery check |
| `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run create-admin -w server` | Operator account |

---

## 5. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Startup exits with "Invalid environment configuration" | It lists each problem. Usually `AUTH_SECRET` is missing or too short, or `MONGODB_URI` is wrong. |
| "MongoDB connection failed" | MongoDB isn't running (`brew services start mongodb-community` on macOS). |
| Emails show "Demo, not delivered" | `EMAIL_PROVIDER` is still `demo`: uncomment the Gmail block and restart. |
| "Email sending is not authorised" | Settings → Integrations → Authorise email sending (needed again after switching from demo to real email). |
| Brand email replies never arrive | The brand must reply to our email (the `+cos-` address); check Settings → Integrations for the inbox checker's last error. |
| Discovery finds only demo brands | Remove `demo` from `DISCOVERY_SOURCES`; tick the real sources in Settings → Discovery. |
| "Last search was incomplete: gdelt …" | GDELT is busy; it retries and falls back to news search through Serper (needs `SERPER_API_KEY`). |
| Instagram: "shared no conversations" | Publish the Meta app, turn on "Allow access to messages", and make sure the sender is an accepted Instagram Tester. Then send a new DM. |
| Instagram reply "not sent: 24-hour window closed" | Instagram only allows replies within 24 hours of the brand's last DM. Reply from the Instagram app; CreatorOS can reply again after their next message. |
| AI drafts say "written from a template" | No AI key, or the free daily quota ran out; it resumes after the quota resets. |
| Nothing happens in the background | The worker isn't running: with `RUN_WORKER_IN_PROCESS=true` it runs inside `npm run dev`. Settings → Integrations shows its heartbeat. |

---

## Architecture

```
client/  React 19 + Vite + React Router + TanStack Query + react-hook-form/zod, plain CSS design tokens
server/  Express 5 + Mongoose 9 + Zod, pino logging, MongoDB-backed job queue
```

```
Browser ──/api/v1──▶ Express API ──▶ MongoDB ◀── Worker(s)
                         │                         │
                         ├─ AI service layer ──────┤  (Anthropic Claude | Google Gemini | dev mock | disabled)
                         ├─ Email adapters ────────┤  (SMTP | demo | disabled; replies by IMAP or webhook)
                         ├─ Instagram DMs ─────────┤  (official Instagram API with Instagram Login)
                         └─ Discovery sources ─────┘  (GDELT news | Serper search | Instagram via Apify | RSS | Brave | demo)
```

### Server layout

| Path | Purpose |
|---|---|
| `src/config/env.js` | Zod-validated environment. Refuses unsafe production setups, e.g. mock AI or a demo email provider. |
| `src/models/` | Mongoose schemas for all entities, with indexes and uniqueness constraints |
| `src/routes/` | Versioned REST routes under `/api/v1` |
| `src/services/discovery/` | Discovery controls, pipeline, sources, taxonomy |
| `src/services/scoring/` | Transparent, weighted opportunity scoring |
| `src/services/negotiation/` | Deterministic policy engine, counteroffers, state machine, inbound processing |
| `src/services/approvals/` | Approval rules, approval lifecycle, the single action executor |
| `src/services/ai/` | Provider-independent AI layer, prompts, schemas, mock provider, templates |
| `src/services/email/` | Email adapters, envelope building, IMAP inbox checker |
| `src/services/instagram/` | Instagram API client, DM sending (24-hour window), inbox checker, DM pitches |
| `src/services/contacts/` | Business contacts from brands' own websites |
| `src/jobs/` | Durable queue, worker, handlers, health |

### Key design decisions

- **Sessions.** Opaque random tokens sit in an httpOnly, SameSite=Lax cookie. The database stores only their SHA-256 hash. Sessions rotate after half their TTL and are revoked on logout, password change or password reset. Passwords use scrypt.
- **CSRF.** Double-submit protection: the readable `cos_csrf` cookie, which is an HMAC of the session, must be echoed in `X-CSRF-Token` on every state-changing request.
- **Money.** All amounts are integer minor units (paise). The UI converts rupee input on submit.
- **The AI never decides limits.** `negotiation/policy.js` evaluates offers, prices the scope against the rate card, applies premiums for rights and exclusivity, and builds counter-terms in plain code. The AI only writes prose. Any AI-drafted negotiation message containing an amount that is not one of the approved figures is discarded and replaced with a template.
- **Prompt injection.** Brand emails and web content go to the model wrapped in `<untrusted_content>` tags and marked as data. The model has no tools: it returns schema-validated JSON and cannot approve, send, or change policies.
- **Durable jobs.** `scheduledJobs` in MongoDB is the queue. Each job has a unique `idempotencyKey`, workers claim jobs atomically with a lease, and a job whose worker died is reclaimed once its lease expires. Retries use exponential backoff with jitter. Workers send heartbeats so the UI never claims "continuous monitoring" while no worker is alive.

### Persistent discovery

- **State.** Each creator has a `discoveryConfigurations` document with one of the states `stopped | running | paused | error | awaiting_configuration`. Discovery starts as **stopped** until the creator enables it.
- **Scheduling.** Each worker tick finds running configurations with `nextRunAt ≤ now`, moves `nextRunAt` forward with a conditional update (so the run is scheduled exactly once across workers), and enqueues `discovery.run` with the key `discovery:<creator>:<slot>`.
- **Controls.** Pause and stop cancel pending discovery jobs. Stop also clears all future scheduling. Neither deletes opportunities. Run-now is limited per creator (`DISCOVERY_MANUAL_RUNS_PER_DAY`), and only one run can be pending at a time.
- **Deduplication.** Opportunities are unique per `(creatorId, dedupeKey)`, where the key is a hash of the brand domain plus the normalised product or campaign. A repeated run refreshes the evidence and `lastVerifiedAt`, and notifies only about genuinely new findings or upgraded intent. Dismissed opportunities never come back.
- **Failures.** Three consecutive failed runs move discovery to `error`, which stops scheduling and alerts the creator. Partial runs record which sources were unavailable.

### Negotiation and approvals

The negotiation states follow the spec, from `initial_outreach` to `closed`. Transitions are validated in `stateMachine.js`.

1. **Offer intake.** An inbound reply is classified. If it is an offer, the terms are extracted, `termsVersion` is incremented, and **all pending approvals for the deal are superseded**.
2. **Analysis.** The deterministic analysis produces checks (`ok | warning | missing | requires_approval | violation`), a recommendation (`accept | counter | clarify | decline | escalate`), reasoning, and trade-offs.
3. **Counteroffer.** The first counter targets the creator's *preferred* rate plus rights premiums. Each later counter comes down halfway from the last one sent towards the brand's offer (or the creator's minimum, if the offer is below it), rounded to ₹500, never below either. When a brand calls an offer final, one at or above the minimum gets an acceptance prepared for approval; one below it gets one last counter at the minimum. Counters strip rights the creator's policy doesn't grant, cap revisions and shorten payment terms. Brand terms carry over between emails, so a fee stated once isn't lost when the next email leaves it out. Once terms are agreed, brand confirmations get a thank-you draft, never another counter.
4. **Approval gate.** `approvals/requirements.js` decides whether an action needs the creator's approval:
   - Accepting or rejecting an offer always does, at every autonomy level. Accepting also requires explicit confirmation.
   - Counteroffers can be sent automatically only at Level 2+, and only inside the authorised rules.
   - Pitches and follow-ups can be sent automatically only at Level 1+, and only when the matching auto-send option is enabled.
   - Sensitive content (legal, tax, medical, financial wording) always needs approval.
   - Unknown actions always need approval.
5. **Approving.** The client must send the `actionHash` it displayed. The server recomputes the hash and re-checks the deal's `termsVersion` and the approval's expiry. It then moves `pending → approved` atomically (so replays fail) and calls `executeApprovedAction`, the only path that can queue a gated send. Edits create a new version that must be approved separately. An approved action can be revoked until the send job starts.
6. **Sending.** The `message.send` job re-checks the approval, the exact content, suppressions, and email authorisation immediately before calling the provider. If a crash interrupts a send mid-flight, the message is marked *failed with unknown outcome* instead of being re-sent.

Auto-authorised actions also create an approval record with status `approved`, `createdBy: system`, and the rule that allowed them. Every execution path is therefore the same and auditable.

### Email

- **Sender identity.** Outbound mail comes from the platform address as `"<Creator> via CreatorOS" <EMAIL_FROM_ADDRESS>`, with a per-conversation `Reply-To: reply+<token>@<EMAIL_REPLY_TO_DOMAIN>`. Every message carries an AI-assistance disclosure and an unsubscribe line.
- **Authorisation.** Creators must authorise sending in Settings → Integrations. The consent text and timestamp are stored.
- **Demo adapter.** Records messages as `simulated`. The UI labels them "Simulated (demo) — not delivered". The demo "Simulate brand reply" tool stores the reply and queues the same `inbound.process` job as the webhook; the timeline shows "Analysing reply…" and refreshes until it finishes.
- **Inbound and bounces.** `POST /api/v1/webhooks/email` takes a signed JSON payload. The signature is `X-CreatorOS-Signature: sha256=HMAC(INBOUND_WEBHOOK_SECRET, "<timestamp>.<rawBody>")` with `X-CreatorOS-Timestamp`, and the timestamp must be within 5 minutes. Point your inbound provider (SendGrid Inbound Parse, Postmark, Mailgun routes, or a small relay) at it and map fields to `{ messageId, inReplyTo, references[], from, to[], subject, text }`. Bounces use `{ type: "bounce", bounce: { originalMessageId, recipient, kind } }`. The webhook only stores the message and answers `202`; classification, offer extraction and drafting run afterwards in the `inbound.process` job, so slow AI calls never make the provider time out. If that job fails for good or is interrupted, the reply is flagged **Needs your review** and the creator is notified.
- **Matching.** Replies are matched only by reply token or RFC 5322 threading headers, never by brand name. A duplicate `messageId` is ignored.
- **Development with your own Gmail (free).** Send with Gmail SMTP and an app password, set `EMAIL_REPLY_TO_ADDRESS=you+cos-{token}@gmail.com`, and set `INBOUND_PROVIDER=imap`. Every minute the worker checks the inbox read-only, downloads only messages sent to a `+cos-` address, and passes them to the normal reply pipeline; other mail is never read. A commented block in `server/.env.example` has the exact settings. This suits a single test creator; production uses each creator's Gmail plus a reply domain.
- **Contacts from brand websites.** For real (non-demo) brands, the `contacts.discover` job reads the brand's own website and stores business emails that are published there, each with the page it came from. It honours robots.txt (RFC 9309), reads at most 8 pages per site one second apart, leaves alone any site that refuses automated access, and skips third-party, placeholder and non-pitchable addresses (no-reply, careers, legal, grievance). It runs automatically when discovery finds a new real brand (re-checked after 30 days) and from **Find on website** on an opportunity (at most once per brand per day). Addresses are never guessed.
- **Suppression.** An opt-out or explicit refusal suppresses that address for the creator. A hard bounce suppresses it globally and marks the contact do-not-contact.

---

### Instagram DMs

CreatorOS uses the official Instagram API with Instagram Login (no unofficial bots, which break Instagram's terms and get accounts banned).

- **What it does:** checks the connected professional account's DMs every minute. Messages from brands become deals and go through the same analysis, negotiation and approvals as email. Messages from fans and friends are skipped and never stored.
- **Instagram's rules:** apps can reply only within 24 hours of the brand's last message, and can never send the first message. To pitch by DM, CreatorOS writes it, you send it from Instagram (copy + open), mark it sent, and CreatorOS takes over when they reply.
- **Setup and testing:** see [Instagram DMs](#instagram-dms) in section 2 and walkthrough 2 in section 3. The Meta app must be **published**, or Instagram shares no conversations with it.
- **Storage:** brand threads are matched by Instagram thread id (or the brand account the creator pitched), never by name. Fan/friend threads keep only a bare "ignored" marker. DMs older than the connection are never imported. Instagram conversations get no automatic follow-ups.
- **Production:** set `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` (HTTPS) for "Connect with Instagram", and pass Meta App Review (`instagram_business_manage_messages`) plus Business Verification to connect other creators' accounts.

## Environment variables

All variables are in `server/.env.example` with comments. The client has no secrets.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | | `development` / `test` / `production` |
| `PORT` | | API port (default 4000) |
| `MONGODB_URI` | ✓ | |
| `FRONTEND_URL` | | Comma-separated allowed origins. The first one is used in password-reset links. |
| `AUTH_SECRET` | ✓ | ≥ 32 characters. Production refuses the placeholder. |
| `ENCRYPTION_KEY` | production | ≥ 32 characters, different from `AUTH_SECRET`. Encrypts stored integration tokens. |
| `SESSION_TTL_HOURS` | | Default 168 |
| `TRUST_PROXY` | | `true` behind a reverse proxy |
| `AI_PROVIDER` | | `auto` (default): Anthropic when its key is set, else Gemini when its key is set, otherwise the mock in dev and disabled in prod. Also `anthropic`, `gemini`, `mock`, `disabled`. |
| `ANTHROPIC_API_KEY` | for real AI | |
| `ANTHROPIC_MODEL` | | Default `claude-opus-5-5` |
| `ANTHROPIC_EFFORT` | | `low`…`max`, default `medium`. Inbound classification always runs at `low`. |
| `GEMINI_API_KEY` | for Gemini | Free key from Google AI Studio. Free-tier prompts may be used by Google to improve its products: use test data only. |
| `GEMINI_MODEL` | | Default `gemini-3.5-flash-lite` (fast, separate free quota). `gemini-3.8-flash` is stronger but its free tier allows only 20 requests per day. When a daily quota runs out, the app stops calling until it resets and uses templates meanwhile. |
| `GEMINI_THINKING_LEVEL` | | `minimal` / `low` / `medium` / `high`, default `medium`. Classification always uses `low`. |
| `EMAIL_PROVIDER` | | `demo` (dev default), `smtp`, `disabled`. Production refuses `demo`. |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO_DOMAIN` | for smtp | Use a domain with SPF/DKIM/DMARC configured |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | for smtp | |
| `INBOUND_WEBHOOK_SECRET` | for inbound | Without it the webhook returns 503 |
| `EMAIL_REPLY_TO_ADDRESS` | | Reply address template containing `{token}`, e.g. `you+cos-{token}@gmail.com`. Default `reply+{token}@EMAIL_REPLY_TO_DOMAIN`. |
| `INBOUND_PROVIDER` | | `webhook` (default), `imap` (poll an inbox every minute, read-only) or `none` |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_SECURE`, `IMAP_USER`, `IMAP_PASS`, `IMAP_MAILBOX` | for imap | User and password default to the SMTP ones |
| `DISCOVERY_SOURCES` | | Any of `demo,rss,brave,gdelt,serper,instagram`. Production refuses `demo`. `serper`/`instagram` report "unavailable" until their key is set. |
| `DISCOVERY_INTERVAL_MINUTES` / `DISCOVERY_MIN_INTERVAL_MINUTES` | | Defaults 1440 / 60 |
| `DISCOVERY_MAX_CONCURRENCY`, `DISCOVERY_MANUAL_RUNS_PER_DAY` | | |
| `BRAVE_SEARCH_API_KEY` | for `brave` | |
| `SERPER_API_KEY` | for `serper` | serper.dev (2,500 free searches on sign-up). Also used to find brand websites for news results. |
| `APIFY_TOKEN` | for `instagram` | apify.com ($5 free credit a month). Creators list similar creators in Settings → Discovery; their recent posts are scanned for paid partnerships, disclosed collaborations and featured brands. Without that list, niche hashtags are scanned. |
| `APIFY_MAX_USD_PER_RUN` | | Hard cost cap per Instagram scrape, default `0.5` |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI` | for Instagram login | Only for the "Connect with Instagram" button (production, HTTPS redirect). Development connects by pasting a token. |
| `INSTAGRAM_API_VERSION`, `INSTAGRAM_POLL_DMS` | | Defaults `v26.0`, `true` (check connected inboxes every minute) |
| `RUN_WORKER_IN_PROCESS` | | `true` in dev. In production set `false` and run `npm run worker`. |
| `WORKER_POLL_MS`, `WORKER_LEASE_MS` | | |
| `DEMO_FEATURES_ENABLED` / `ALLOW_DEMO_IN_PRODUCTION` | | The simulated-reply tool and the demo dataset |

Configuration is validated at startup, and the process exits with a list of problems. Secret values are never printed.

---

## Integrations and their states

Every integration reports an explicit state in Settings → Integrations:

| Integration | States | Notes |
|---|---|---|
| Email | `connected`, `demo`, `degraded`, `disconnected`, `unavailable` | SMTP or demo. No per-creator mailbox credentials are stored in the MVP. |
| AI | `connected`, `demo` (mock), `degraded` (after a recent failure), `disconnected` | Providers: Anthropic Claude (launch target) or Google Gemini (development; Interactions API with `store: false`), both sending the same prompts and validated by the same schemas. With the Anthropic SDK, requests use structured JSON output, `fallbacks: "default"` (server-side refusal fallback), typed error handling, and timeouts with retries. Model failures fall back to deterministic templates and never bypass rules. |
| Discovery sources | per run: `ok`, `skipped`, `unavailable`, `error` | `demo` is fictional brands on the reserved `.example` TLD, labelled everywhere. `rss` reads official brand newsroom feeds the creator configures, through an SSRF-guarded fetch. `brave` uses the Brave Search API, and its results are stored as *unverified hypotheses*. |
| Instagram DMs | `connected`, `degraded` (needs reconnecting), `disconnected` | Official Instagram API with Instagram Login; see "Instagram DMs" above. |
| WhatsApp | `unavailable` | Planned. Requires the WhatsApp Business Platform; there are no unofficial automations. Off-platform conversations can be recorded as notes. |
| Payments | n/a | Invoices and payment status only. "Paid" is always labelled **creator-reported**, because CreatorOS never moves or holds money. |

**Integration credentials.** Instagram access tokens are stored in `integrationConnections.encryptedCredentialReference`, encrypted with AES-256-GCM under a key derived from `ENCRYPTION_KEY` (required in production; development falls back to `AUTH_SECRET`, and tokens saved under `AUTH_SECRET` still decrypt after `ENCRYPTION_KEY` is added), and are never returned by the API. Rotating `AUTH_SECRET` signs everyone out but does not disconnect integrations; rotating `ENCRYPTION_KEY` does. Before launch, move the key to a KMS or secret manager.

---

## Test coverage (detail)

How to run the tests and live checks is in [section 3](#3-test-everything). What the automated tests cover:

- **Server: 159 tests** (Vitest + Supertest). They start an ephemeral `mongod`, using the locally installed binary when available (or `MONGOMS_SYSTEM_BINARY`), or connect to `TEST_MONGODB_URI`.
  - Unit tests: policy evaluation, counteroffers, authorised-rule checks, approval requirements, state machine, scoring, dedupe keys, amount parsing, the mock extractor, money, SSRF guard, business days, production config safety.
  - Integration tests: auth, CSRF, operator injection, password reset, ownership isolation, discovery start/pause/resume/stop, recovery after worker restart, the worker-health honesty check, source-failure → error state, quota, feed SSRF validation.
  - End-to-end API flow: register → onboard → discovery → pitch → approval → simulated send → inbound offer → analysis → counter → superseded approval → edit/reject → accept with explicit confirmation → agreement → campaign → deliverable evidence → invoice → creator-reported payment.
  - Mandatory negative tests: approval bypass, tampered approvals, prompt injection, opt-out suppression, provider failure never reported as sent, transient retry with backoff, duplicate webhook, signature check, no brand-name matching, rogue-model fallback, revoke before execution, follow-up drafting.
  - Email and negotiation: Gmail IMAP inbox checker (read-only, only reply addresses, no re-import), replies kept in one thread, brand terms carried across emails, counters stepping down, final offers, no counter after agreement, consent rules for real sending.
  - Instagram (with a fake Instagram): token connect and encryption, brand vs fan filtering (fans never stored), deals from brand DMs, sends only inside the 24-hour window, DM pitches sent by the creator and picked up on reply.
  - Discovery sources (with fakes): GDELT retries and news fallback, programme-page and platform filtering, Instagram partnership signals.
  - Reliability: webhook stores then the worker processes, re-queueing a stored-but-unqueued reply, no duplicate offer on retry, interrupted processing handed to the creator, concurrent outreach opens one deal, executor refuses a non-draft message before touching the deal.
- **Client: 4 tests** for formatting and labels.

The live checks (`ai:smoke`, `discovery:smoke`) are described in section 3. `ai:smoke` also checks drafts against the style rules (first person, Indian ₹ format, no name sign-off), prints pass/fail per step with latency and tokens, and estimates the cost.

---

## Deployment

1. Provision MongoDB (Atlas or self-hosted replica set), configure SMTP plus SPF/DKIM/DMARC, and set up an inbound email relay to the webhook.
2. Set `NODE_ENV=production`, a strong `AUTH_SECRET`, a separate `ENCRYPTION_KEY`, `TRUST_PROXY=true`, `EMAIL_PROVIDER=smtp`, `DISCOVERY_SOURCES=rss` (or `rss,brave`), `ANTHROPIC_API_KEY`, and `RUN_WORKER_IN_PROCESS=false`.
3. Build the client with `npm run build` (output: `client/dist`). Serve it from the same origin as the API behind a reverse proxy: `/api/*` → API, everything else → `client/dist` with SPA fallback to `index.html`. Same-origin serving keeps the SameSite cookies and CSRF model intact.
4. Run one or more API processes:
   ```bash
   npm start
   ```
   and one or more workers:
   ```bash
   npm run worker
   ```
   Both shut down gracefully on SIGTERM. Unfinished jobs are reclaimed after their lease expires.
5. Point health checks at `GET /api/v1/health` (liveness) and `GET /api/v1/ready` (database, worker heartbeat, provider states).
6. Create an operator account:
   ```bash
   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run create-admin -w server
   ```
   `GET /api/v1/admin/metrics` returns aggregate operational data only, and every access is audit-logged.

**Migrations.** Startup runs `createCollection` and `syncIndexes` for every model. Schema changes are additive with defaults. Data backfills should go in a `server/scripts/migrate-<date>.js` script, run once with the same env.

---

## Privacy and compliance notes

- Settings → Privacy offers a full JSON export and permanent account deletion. A minimal deletion audit record with no personal data is kept.
- Logs redact passwords, tokens, cookies, message bodies, and email addresses. Audit metadata is redacted the same way.
- Creator-entered audience metrics are always labelled creator-provided. The platform never fabricates metrics, contacts, budgets, or brand intent.
- These practices were designed with India's DPDP Act in mind (purpose limitation, access, erasure) and ASCI influencer disclosure guidelines (a disclosures field in campaign briefs). They are not legal advice; review them with counsel before launch.

## Known limitations

See [CHECKLIST.md](CHECKLIST.md) → "Outstanding". In short:
- Claude (Anthropic) has not been called live yet (no credits); development runs on Gemini. Gmail (SMTP + IMAP) and Instagram DMs have been tested live with a single creator account.
- Instagram uses inbox polling every minute; webhooks (instant notifications) need a public HTTPS deployment.
- Browser-level E2E tests (Playwright) are not set up. The API-level E2E flow and a manual browser walkthrough cover the UI wiring.
- Indian public holidays are not used in business-day scheduling.
- DNS-rebinding protection for user-configured feed URLs is best-effort: the address is validated before each request, but connections are not pinned to it.

## Credits

News discovery uses the [GDELT Project](https://www.gdeltproject.org/), whose data is free for commercial use with attribution.
