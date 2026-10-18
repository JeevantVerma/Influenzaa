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
- **Real:** auth and security, MongoDB models, durable job queue and discovery scheduler, deterministic negotiation policy engine, approval system, inbox, campaigns and invoices, audit trail, 71 tests.
- **Stand-ins (no credentials yet):**
  - AI is a rule-based **mock** (`AI_PROVIDER=auto` with no key). The Claude provider code exists but has never called the live API.
  - Email uses the **demo** adapter: messages are recorded as `simulated` and never delivered.
  - Discovery data is a **fictional** dataset (`*.example` brands). The RSS source needs creator-added feeds; Brave needs a key.
  - Brand replies come only from the "Simulate brand reply" button.
- **Weak:** the UI and UX are admin-panel quality and need a proper design pass. The UI has never been reviewed visually; screenshots need the browser pane open (Ctrl+Shift+B).
- **Agreed next priorities** (the user picks the order):
  1. Real AI (Claude) and real discovery: Claude web search, Meta Ad Library, a contact provider.
  2. UI/UX redesign of the core screens: dashboard, opportunity, pitch review, negotiation.
  3. Real email: platform sender vs creator Gmail OAuth (undecided), inbound relay, deliverability.
  4. Launch readiness: legal/DPDP, hosting, monitoring, billing, beta.
- Detailed progress is in `CHECKLIST.md`. Keep it in sync.

## Stack
- npm workspaces, **JavaScript (ESM), not TypeScript.**
- `server/`: Node 22, Express 5, Mongoose 9, Zod 4, pino, nodemailer, `@anthropic-ai/sdk`, Vitest + Supertest + mongodb-memory-server-core.
- `client/`: React 19, Vite 8, React Router 7, TanStack Query 5, react-hook-form + zod, **plain CSS** with tokens in `client/src/styles/tokens.css`. No CSS framework.
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
npm run worker         # standalone worker (production: RUN_WORKER_IN_PROCESS=false)
```
- Single server test file: `cd server && npx vitest run test/integration/e2e-deal-flow.test.js`
- Preview servers: `.claude/launch.json` defines `api` (4000) and `web` (**5180**). Use `preview_start`.

## Local environment quirks (this machine)
- MongoDB 8.0 is installed at `C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe`, but the Windows service is **stopped**. Start `mongod` manually with a scratch `--dbpath` (background) before `npm run dev`. Tests start their own mongod from that binary.
- **Port 5173 is used by an unrelated process**, so the web preview runs on 5180, and `server/.env` `FRONTEND_URL` includes it.
- Shell is Windows (Git Bash / PowerShell). Python edits on source files must use `encoding='utf-8'`, because the files contain non-ASCII characters.
- `npm install <pkg>` inside a workspace folder can fail to persist. Use `npm install -w client <pkg>` (or `-w server`) from the root.

## Architecture map
| Area | Location |
|---|---|
| Env validation (refuses mock/demo in production) | `server/src/config/env.js` |
| Express app, middleware order | `server/src/app.js` (webhooks mounted before `express.json` for raw-body HMAC) |
| Auth, sessions, CSRF | `services/auth.service.js`, `middleware/auth.js` |
| Models | `server/src/models/` (money in integer **minor units**; `isDemo` flags) |
| Job queue, worker, scheduler | `server/src/jobs/` (`queue.js`, `worker.js`, `handlers.js`, `health.js`) |
| Discovery | `services/discovery/` (`discovery.service.js` controls, `pipeline.js`, `sources/`, `taxonomy.js`) |
| Scoring | `services/scoring/score.js` |
| Negotiation | `services/negotiation/` (`policy.js` deterministic engine, `stateMachine.js`, `negotiation.service.js` incl. inbound processing) |
| Approvals | `services/approvals/` (`requirements.js` gate rules, `approval.service.js` lifecycle, `executor.js` single execution path, `actionHash.js`) |
| Outbound and send job | `services/messaging.service.js`, `services/email/index.js` |
| AI layer | `services/ai/` (`index.js` facade + template fallbacks, `anthropic.provider.js`, `mock.provider.js`, `prompts.js`, `schemas.js`) |
| Routes | `server/src/routes/*.routes.js`; Zod schemas in `server/src/validators/schemas.js` |
| Client API and hooks | `client/src/api/client.js` (CSRF header), `client/src/api/hooks.js` (`useApi`, `useAction`) |
| Client pages and components | `client/src/pages/`, `client/src/components/` |

## Do not break (covered by tests)
- Gated actions execute **only** through `executeApprovedAction`, with an `approved` record whose `actionHash` matches and whose `boundTermsVersion` equals the deal's `termsVersion`.
- A new brand offer increments `termsVersion` and supersedes pending approvals. Approving runs `pending → approved` atomically, so replays fail.
- Accepting or declining an offer always needs approval; accepting also needs `confirm: true`.
- The AI never decides commercial limits. Monetary figures in AI drafts are checked against approved amounts; on mismatch the template fallback is used.
- Untrusted content (emails, web pages) goes to the model wrapped in `<untrusted_content>`. The model has no tools.
- Opportunity dedupe is unique on `(creatorId, dedupeKey)`. Inbound dedupe is a unique `externalMessageId`. Inbound matching uses reply token or threading headers only, never brand name.
- Stopping discovery cancels pending runs and future scheduling and keeps opportunities. The UI must not claim monitoring while the worker is unhealthy.
- A send interrupted mid-flight (`sending`) is marked failed with unknown outcome and never re-sent. Provider failures are never shown as sent.
- Payments are only ever `creator_reported`. The app never moves money.
- Every query is scoped by `creatorId` (another creator's records return 404).

## Conventions
- Follow the existing style: ESM, 2-space indent, single quotes, comments only where intent isn't obvious.
- Validate every request body and query with Zod (`validate({ body | query })`); queries land in `req.validatedQuery` (Express 5).
- Write new services as modules in `server/src/services/`, keep route handlers thin, and throw errors from `lib/errors.js`.
- Use `returnDocument: 'after'` with `findOneAndUpdate`, not `new: true`.
- Client mutations go through `useAction` (success toast only after the server confirms). In forms, use functional `setState` updates.
- Label demo, mock and simulated data visibly in the UI.
- After changes, run `npm run lint`, `npm test` and `npm run build`, and fix failures before reporting.
- Default Claude model is `claude-opus-5-5` (`ANTHROPIC_MODEL`). Read the `claude-api` skill before changing SDK code.
