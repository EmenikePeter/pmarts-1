# PMARTS Copilot Instructions

Team-wide standards and guidelines for using GitHub Copilot in the PMARTS monorepo.

## Project Overview

PMARTS is a production-grade escrow and trust system for the Pi Network ecosystem. The monorepo contains:
- **mobile/** — React Native Expo app (TypeScript)
- **pmarts-admin/** — Next.js admin dashboard (TypeScript, Tailwind CSS)
- **api/** — Express.js backend (JavaScript/TypeScript, Supabase PostgreSQL)
- **supabase/** — Database schema and migrations
- **docs/** — Architecture and workflow documentation
- **scripts/** — Development utilities and testing tools

## Recommended Agents

### For PMARTS-Specific Work
Use the `@pmarts` agent when working on:
- Features spanning multiple services (mobile/admin/api)
- Escrow transactions, dispute workflows, or trust scoring
- Database migrations and RLS policies
- Cross-service debugging and integration issues
- Feature implementation with full context of system design

### For General Web Development
Use the `@web-dev-fullstack` agent when working on:
- Framework-agnostic patterns (React, Node.js, databases)
- Technologies outside PMARTS stack
- Learning or reference implementations
- Exploring alternative approaches

## Coding Standards

### Naming Conventions
- **Files**: `kebab-case` (e.g., `user-profile.tsx`, `transaction-handler.ts`)
- **Components** (React): `PascalCase` (e.g., `UserProfile`, `TransactionCard`)
- **Functions/Variables**: `camelCase` (e.g., `getUserTransactions`, `isDisputeActive`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `API_TIMEOUT_MS`, `MAX_ALLOWED_DISPUTES`)
- **Database tables/columns**: `snake_case` (e.g., `user_trust_scores`, `dispute_status`)

### File Organization
- **API routes**: `api/src/routes/<feature>/` (e.g., `api/src/routes/disputes/`)
- **Mobile screens**: `mobile/src/screens/<feature>/` (e.g., `mobile/src/screens/TransactionFlow/`)
- **Admin pages**: `pmarts-admin/app/<feature>/` (e.g., `pmarts-admin/app/disputes/`)
- **Shared types**: Colocated in service; import across services carefully to avoid circular deps
- **Database queries**: `lib/queries/` in each service, with exported typed functions

### Type Safety
- **TypeScript strict mode required** across all services
- **No `any` types** without documented justification (use `unknown` and type narrowing)
- **Full type coverage** for domain models (transactions, disputes, users, trust scores)
- **Enums for states** (e.g., `TransactionStatus`, `DisputeStage`)
- **Export types clearly** for cross-service consumption

### Error Handling
- **User-facing errors**: Clear, actionable messages (avoid technical jargon)
- **API errors**: Proper HTTP status codes (e.g., 400 for validation, 401 for auth, 409 for conflicts)
- **Database errors**: Catch and wrap with context (e.g., "Failed to update transaction status: {reason}")
- **Logging**: Use structured logging with context (timestamp, user ID, transaction ID, error trace)
- **Silent failures forbidden** — always report errors to users or logs

### Database Standards
- **Migrations tracked** in `supabase/migrations/<number>_<description>.sql`
- **Migration format**: Up/down sections, idempotent operations, no data loss
- **RLS policies required** for sensitive tables (users, transactions, disputes, trust scores)
- **Foreign keys enforced** with `ON DELETE` behavior specified
- **Indexes created** for frequently queried columns (e.g., `user_id`, `transaction_id`, `dispute_id`)
- **Atomic operations** for multi-step updates (use transactions for escrow releases, payouts)

### Testing Requirements
- **API endpoints**: Integration tests covering happy path, error cases, edge cases
- **Database migrations**: Test up/down migrations, verify no data loss
- **Business logic**: Tests for transaction state machine, dispute resolution rules, fraud detection
- **Mobile components**: Component snapshot tests, screen navigation tests
- **Admin pages**: CRUD operation tests, data table filtering/sorting, real-time updates

## Development Workflow

### Branch Strategy
- **Feature branches**: `feature/<description>` (e.g., `feature/dispute-appeal-flow`)
- **Bug fixes**: `fix/<issue-id>-<description>` (e.g., `fix/123-transaction-timeout`)
- **Refactor**: `refactor/<description>` (e.g., `refactor/trust-scoring-algorithm`)
- **Base branch**: Always `main` (no long-lived feature branches)

### Commit Hygiene
- **Atomic commits** — One logical change per commit, not per file
- **Descriptive messages** — What changed and why, not how
- **Example**: ✅ "Add dispute appeal request handler with payout recalculation"
- **Example**: ❌ "Updated files" or "Fixed bug"
- **Link issues** — Reference GitHub issues in commit body (e.g., `Fixes #123`)

### Pull Request Standards
- **Title**: Starts with service acronym (e.g., `[API]`, `[Mobile]`, `[Admin]`) for clarity
- **Description**: What changed, why it changed, how to test it
- **Self-review**: Check for obvious issues before requesting review
- **Cross-service PRs**: Flag that testing spans multiple services
- **Migrations included?**: Always mention migration changes explicitly
- **Breaking changes?** Document impact and migration path

### Code Review Checklist
- [ ] Does this follow naming/file organization standards?
- [ ] Are all errors handled with clear user messages?
- [ ] Is sensitive data protected (PII, auth tokens, keys)?
- [ ] Are database migrations safe (idempotent, reversible)?
- [ ] Do tests cover happy path, error cases, and edge cases?
- [ ] Are new dependencies justified?
- [ ] Is documentation (comments, types, README) updated?

## Deployment Standards

### Environment Configuration
- **Production secrets** — Use Supabase environment variables, never hardcode
- **Environment-specific behavior** — Check `NODE_ENV`, feature flags, not IP addresses
- **Secrets never in code** — Use `.env.example` to document required keys
- **Mobile secrets** — Store in EAS secrets, reference in `eas.json`

### Mobile Deployment (EAS)
- **Version bumping** — Semantic versioning in `mobile/app.json` before build
- **EAS build triggers** — Run tests before initiating build
- **Staging + production** — Two separate EAS channels for phased rollout
- **Rollback plan** — Keep previous version binary available for quick rollback

### Admin Dashboard Deployment (Vercel)
- **Code pushed to main** — Automatic deployment to production
- **Staging environment** — `staging` branch deploys to preview environment
- **Environment variables** — Configured in Vercel dashboard, never in code

### API Deployment
- **Health checks** — Endpoint at `/health` returns service status
- **Graceful shutdown** — Complete in-flight requests before terminating
- **Database migrations** — Run before API startup, with rollback plan
- **Webhook safety** — Idempotency keys, signature verification, retry logic

## Common Workflows

For step-by-step guidance on common tasks, see `.github/prompts/`:
- Use `/api-endpoint-template` to design new API endpoints
- Use `/feature-checklist` to plan mobile + API + admin features
- Use `/migration-template` to safely modify database schemas
- Use `/bug-triage` to diagnose cross-service issues
- Use `/code-review` to validate pull requests

## Questions & Escalation

- **Architecture questions**: Post in #architecture-discussion
- **Database design help**: Reach out to DBA (if available) before major changes
- **Security concerns**: Flag to security lead before merging
- **Performance questions**: Use APM tools to baseline before/after optimization
