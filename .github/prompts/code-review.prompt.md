---
name: "Code Review"
description: "Validate pull requests against PMARTS standards and best practices. Use before merging to catch issues with naming, errors, security, database safety, and testing."
argument-hint: "Share the PR title and description, or paste code snippets to review"
---

# Code Review Checklist & Validation

Automated code review against PMARTS standards before merging.

## Files & Organization

- [ ] **File naming** — `kebab-case` for files (e.g., `user-profile.tsx`, not `userProfile.tsx`)
- [ ] **Component naming** — `PascalCase` for React components (e.g., `UserProfile`, not `user-profile`)
- [ ] **File location** — Routes in `api/src/routes/`, screens in `mobile/src/screens/`, pages in `pmarts-admin/app/`
- [ ] **Import paths** — Relative imports within same service, absolute imports for types
- [ ] **Unused imports** — No dead code or unused dependencies

## Type Safety & Definitions

- [ ] **TypeScript strict mode** — No `any` types without documented justification
- [ ] **Type coverage** — All parameters and return types defined
- [ ] **Domain models** — Transaction, Dispute, User types properly defined
- [ ] **Enums** — State values use enums (e.g., `TransactionStatus`, not string literals)
- [ ] **Exports** — Types exported clearly for cross-service use
- [ ] **Type consistency** — Frontend/backend types aligned (dates, null handling, etc.)

## Error Handling

- [ ] **User-facing errors** — Clear, actionable messages (avoid technical jargon)
- [ ] **HTTP status codes** — Correct codes (400 validation, 401 auth, 409 conflict, 500 server)
- [ ] **Error logging** — Structured logging with context (user ID, transaction ID)
- [ ] **Silent failures prevented** — All errors reported to user or logs
- [ ] **Validation errors** — Input validation with helpful error messages
- [ ] **Database errors** — Caught and wrapped with context

## Database Safety

- [ ] **Migrations included?** — Schema changes tracked in `supabase/migrations/`
- [ ] **Migration testing** — Up AND down migrations tested
- [ ] **RLS policies** — Sensitive tables have RLS enabled and enforced
- [ ] **Foreign keys** — Relationships enforced with proper `ON DELETE` behavior
- [ ] **Indexes** — Added for frequently queried columns (performance)
- [ ] **Atomicity** — Multi-step operations use transactions (escrow releases, payouts)
- [ ] **Data preservation** — No destructive operations without backups

## Cross-Service Integration

- [ ] **API contract** — Changes to API endpoints documented for mobile/admin
- [ ] **Real-time updates** — Admin dashboard subscribes to changes via Supabase Realtime
- [ ] **Permission checks** — Correct RLS policies prevent unauthorized access
- [ ] **State consistency** — Mobile, API, admin all see same data state
- [ ] **Backward compatibility** — Mobile and admin work with new API version

## Testing

- [ ] **Test coverage** — Happy path, error cases, edge cases tested
- [ ] **API endpoints** — Integration tests with request/response validation
- [ ] **Database migrations** — Migration tests verify schema changes work
- [ ] **Mobile screens** — Component tests for navigation and data display
- [ ] **Admin pages** — CRUD operation tests, permission tests
- [ ] **Business logic** — Tests for state machine, dispute rules, fraud detection
- [ ] **Test quality** — Tests verify behavior, not just code coverage

## Security & Privacy

- [ ] **Secrets handling** — No hardcoded keys, credentials, or PII in code
- [ ] **Environment variables** — Sensitive config in `.env`, not code
- [ ] **SQL injection prevention** — Using parameterized queries, Supabase client (not string concat)
- [ ] **Authentication** — Routes properly check user identity and permissions
- [ ] **Authorization** — RLS policies enforce data access rules
- [ ] **Data protection** — Sensitive data (transactions, disputes) properly guarded

## Code Quality

- [ ] **Naming conventions** — Variables/functions use meaningful `camelCase` names
- [ ] **Comments** — Complex logic explained, non-obvious decisions documented
- [ ] **Consistency** — Code style matches existing codebase
- [ ] **Complexity** — Functions do one thing well (no 200-line monsters)
- [ ] **Dependencies** — New packages justified and version-pinned
- [ ] **No debug code** — `console.log`, breakpoints, test data removed

## Documentation

- [ ] **Comments** — Complex business logic explained (dispute rules, fraud heuristics)
- [ ] **Type definitions** — JSDoc comments for public APIs
- [ ] **README** — Updated if new features or setup changes
- [ ] **Deployment notes** — Breaking changes documented for operators
- [ ] **Changelog** — Feature/bug fix documented if maintaining one
- [ ] **Examples** — Provided for new patterns if introducing them

## Mobile-Specific

- [ ] **Permissions** — New features declare required permissions
- [ ] **Offline support** — Handles network failures gracefully
- [ ] **Accessibility** — Proper labels, touch targets, contrast
- [ ] **Performance** — No unnecessary renders, efficient queries
- [ ] **Device testing** — Tested on iOS and Android (or using Expo)

## Admin Dashboard-Specific

- [ ] **Permissions** — Admin features guard with role checks
- [ ] **Data tables** — Filtering and sorting work correctly
- [ ] **Bulk operations** — Confirm dialog, transaction safety
- [ ] **Real-time sync** — Updates appear without page refresh
- [ ] **Performance** — Large datasets load efficiently

## API-Specific

- [ ] **Route design** — Follows REST conventions (correct verbs, paths)
- [ ] **Validation** — Request body schema validated before processing
- [ ] **Response format** — Consistent error and success response structure
- [ ] **Idempotency** — Repeated requests are safe (for webhooks, retries)
- [ ] **Rate limiting** — Prevents abuse of expensive operations
- [ ] **Documentation** — OpenAPI/Swagger comments or separate docs

## Summary

After review, provide:
1. **Issues found** — Any violations of standards
2. **Risk level** — Critical (security/data loss), high (bugs), medium (style), low (nitpicks)
3. **Fix priority** — Must fix vs. nice to have
4. **Approval?** — Ready to merge or needs changes
