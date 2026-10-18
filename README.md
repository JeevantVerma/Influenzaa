# CreatorOS

An India-first AI talent manager for independent creators. CreatorOS keeps looking for sponsors in the background, explains with evidence why each brand looks relevant now, drafts outreach, negotiates inside the boundaries the creator sets, and runs confirmed deals through to invoice and payment tracking.

The core rule is enforced on the server: **nothing binding or outbound is executed without a valid approval record**, except for actions the creator explicitly allowed through their autonomy settings. Approvals are bound to the exact message and terms version the creator reviewed.

> Working title. Status: MVP with a production-minded architecture. See [CHECKLIST.md](CHECKLIST.md) for what is done and what is left.

---

## Quick start (development)

Prerequisites: Node.js ≥ 20.11 (tested on 22), MongoDB 7 or 8 running locally.

```bash
npm install
```

```bash
cp server/.env.example server/.env
```

Set `AUTH_SECRET` in `server/.env` to a long random string:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Start the API (with its in-process background worker) and the web app:

```bash
npm run dev
```

- Web app: http://localhost:5173 (Vite proxies `/api` to the API, so cookies stay same-origin)
- API: http://localhost:4000/api/v1 (`/health`, `/ready`, `/openapi.json`)

Optional demo account with a completed profile and discovered opportunities:

```bash
npm run db:seed-demo
```

It prints a generated password and also saves it to `server/.demo-credentials` (gitignored).

### MongoDB setup

Any MongoDB 7+ deployment works. Locally on Windows, either start the installed service (`net start MongoDB`, as administrator) or run `mongod` directly:

```bash
"C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe" --dbpath ./.mongo-data
```

Collections and indexes are created on startup. You can also create them explicitly:

```bash
npm run db:init
```

There are no destructive migrations yet. Schema changes are additive, and `syncIndexes()` runs on every boot (see "Deployment").

---

## Architecture

```
client/  React 19 + Vite + React Router + TanStack Query + react-hook-form/zod, plain CSS design tokens
server/  Express 5 + Mongoose 9 + Zod, pino logging, MongoDB-backed job queue
```

```
Browser ──/api/v1──▶ Express API ──▶ MongoDB ◀── Worker(s)
                         │                         │
                         ├─ AI service layer ──────┤  (Anthropic Claude | dev mock | disabled)
                         ├─ Email adapters ────────┤  (SMTP | demo | disabled)
                         └─ Discovery sources ─────┘  (demo dataset | RSS/Atom feeds | Brave Search API)
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
| `src/services/email/` | Email adapters and envelope building |
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
3. **Counteroffer.** The counter targets the creator's *preferred* rate plus rights premiums, never the minimum and never less than the brand already offered. It strips rights the creator's policy doesn't grant, caps revisions, and shortens payment terms.
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
- **Demo adapter.** Records messages as `simulated`. The UI labels them "Simulated (demo) — not delivered".
- **Inbound and bounces.** `POST /api/v1/webhooks/email` takes a signed JSON payload. The signature is `X-CreatorOS-Signature: sha256=HMAC(INBOUND_WEBHOOK_SECRET, "<timestamp>.<rawBody>")` with `X-CreatorOS-Timestamp`, and the timestamp must be within 5 minutes. Point your inbound provider (SendGrid Inbound Parse, Postmark, Mailgun routes, or a small relay) at it and map fields to `{ messageId, inReplyTo, references[], from, to[], subject, text }`. Bounces use `{ type: "bounce", bounce: { originalMessageId, recipient, kind } }`.
- **Matching.** Replies are matched only by reply token or RFC 5322 threading headers, never by brand name. A duplicate `messageId` is ignored.
- **Suppression.** An opt-out or explicit refusal suppresses that address for the creator. A hard bounce suppresses it globally and marks the contact do-not-contact.

---

## Environment variables

All variables are in `server/.env.example` with comments. The client has no secrets.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | | `development` / `test` / `production` |
| `PORT` | | API port (default 4000) |
| `MONGODB_URI` | ✓ | |
| `FRONTEND_URL` | | Comma-separated allowed origins. The first one is used in password-reset links. |
| `AUTH_SECRET` | ✓ | ≥ 32 characters. Production refuses the placeholder. |
| `SESSION_TTL_HOURS` | | Default 168 |
| `TRUST_PROXY` | | `true` behind a reverse proxy |
| `AI_PROVIDER` | | `auto` (default): Anthropic when a key is set, otherwise the mock in dev and disabled in prod |
| `ANTHROPIC_API_KEY` | for real AI | |
| `ANTHROPIC_MODEL` | | Default `claude-opus-5-5` |
| `ANTHROPIC_EFFORT` | | `low`…`max`, default `medium` |
| `EMAIL_PROVIDER` | | `demo` (dev default), `smtp`, `disabled`. Production refuses `demo`. |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO_DOMAIN` | for smtp | Use a domain with SPF/DKIM/DMARC configured |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | for smtp | |
| `INBOUND_WEBHOOK_SECRET` | for inbound | Without it the webhook returns 503 |
| `DISCOVERY_SOURCES` | | `demo,rss,brave`. Production refuses `demo`. |
| `DISCOVERY_INTERVAL_MINUTES` / `DISCOVERY_MIN_INTERVAL_MINUTES` | | Defaults 1440 / 60 |
| `DISCOVERY_MAX_CONCURRENCY`, `DISCOVERY_MANUAL_RUNS_PER_DAY` | | |
| `BRAVE_SEARCH_API_KEY` | for `brave` | |
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
| AI | `connected`, `demo` (mock), `degraded` (after a recent failure), `disconnected` | With the Anthropic SDK, requests use structured JSON output, `fallbacks: "default"` (server-side refusal fallback), typed error handling, and timeouts with retries. Model failures fall back to deterministic templates and never bypass rules. |
| Discovery sources | per run: `ok`, `skipped`, `unavailable`, `error` | `demo` is fictional brands on the reserved `.example` TLD, labelled everywhere. `rss` reads official brand newsroom feeds the creator configures, through an SSRF-guarded fetch. `brave` uses the Brave Search API, and its results are stored as *unverified hypotheses*. |
| WhatsApp, Instagram | `unavailable` | Planned for later. They require official Meta/WhatsApp Business Platform access, and there are no unofficial or cold-DM automations. Off-platform conversations can be recorded as notes. |
| Payments | n/a | Invoices and payment status only. "Paid" is always labelled **creator-reported**, because CreatorOS never moves or holds money. |

**Integration credentials.** The MVP stores no per-creator provider tokens. `integrationConnections.encryptedCredentialReference` is reserved for that. Before adding OAuth providers, store tokens encrypted with AES-256-GCM under a key from a KMS or secret manager, and keep only a reference in MongoDB.

---

## Testing

```bash
npm test
```

- **Server: 67 tests** (Vitest + Supertest). They start an ephemeral `mongod`, using the locally installed binary when available (or `MONGOMS_SYSTEM_BINARY`), or connect to `TEST_MONGODB_URI`.
  - Unit tests: policy evaluation, counteroffers, authorised-rule checks, approval requirements, state machine, scoring, dedupe keys, amount parsing, the mock extractor, money, SSRF guard, business days, production config safety.
  - Integration tests: auth, CSRF, operator injection, password reset, ownership isolation, discovery start/pause/resume/stop, recovery after worker restart, the worker-health honesty check, source-failure → error state, quota, feed SSRF validation.
  - End-to-end API flow: register → onboard → discovery → pitch → approval → simulated send → inbound offer → analysis → counter → superseded approval → edit/reject → accept with explicit confirmation → agreement → campaign → deliverable evidence → invoice → creator-reported payment.
  - Mandatory negative tests: approval bypass, tampered approvals, prompt injection, opt-out suppression, provider failure never reported as sent, transient retry with backoff, duplicate webhook, signature check, no brand-name matching, rogue-model fallback, revoke before execution, follow-up drafting.
- **Client: 4 tests** for formatting and labels.

```bash
npm run lint
```

```bash
npm run build
```

---

## Deployment

1. Provision MongoDB (Atlas or self-hosted replica set), configure SMTP plus SPF/DKIM/DMARC, and set up an inbound email relay to the webhook.
2. Set `NODE_ENV=production`, a strong `AUTH_SECRET`, `TRUST_PROXY=true`, `EMAIL_PROVIDER=smtp`, `DISCOVERY_SOURCES=rss` (or `rss,brave`), `ANTHROPIC_API_KEY`, and `RUN_WORKER_IN_PROCESS=false`.
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
- No real Anthropic or SMTP traffic has been exercised in this environment (no credentials). Those paths have unit-level coverage and typed error handling only.
- Browser-level E2E tests (Playwright) are not set up. The API-level E2E flow and a manual browser walkthrough cover the UI wiring.
- Indian public holidays are not used in business-day scheduling.
- DNS-rebinding protection for user-configured feed URLs is best-effort: the address is validated before each request, but connections are not pinned to it.
