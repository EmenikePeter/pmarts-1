---
name: "Feature Checklist"
description: "Plan a feature that spans mobile, admin dashboard, and API. Use when implementing full-stack features like new transaction types or dispute workflows."
argument-hint: "Describe the feature, e.g. 'Add dispute appeal extension functionality'"
---

# Full-Stack Feature Checklist

Use this checklist to plan and implement a feature across mobile → API → admin.

## 1. Requirements & Data Model

- [ ] What is the user workflow? (mobile user actions → API operations → admin visibility)
- [ ] What data needs to be stored? (New tables? Schema changes?)
- [ ] What are the state transitions? (e.g., state machine for appeals)
- [ ] What permissions apply? (Who can see/edit this data?)

## 2. Database

- [ ] Create migration in `supabase/migrations/`
- [ ] Define RLS policies for sensitive data
- [ ] Add indexes for frequently queried columns
- [ ] Test migration (up/down both work)
- [ ] Update `docs/DATABASE_SCHEMA.md` if schema changes

## 3. API Implementation

- [ ] Design endpoints (list, create, update, get detail)
- [ ] Define request/response types (TypeScript interfaces)
- [ ] Implement route handlers in `api/src/routes/<feature>/`
- [ ] Add database query functions in `api/src/lib/queries/`
- [ ] Implement proper error handling and validation
- [ ] Add integration tests
- [ ] Document endpoints (OpenAPI or comments)

## 4. Mobile Implementation

- [ ] Create screen components in `mobile/src/screens/<feature>/`
- [ ] Add navigation routes in navigation config
- [ ] Implement API calls using Supabase client
- [ ] Add form validation and error messages
- [ ] Implement loading and error states
- [ ] Add component tests
- [ ] Test on iOS and Android (or test with Expo)

## 5. Admin Dashboard

- [ ] Create page in `pmarts-admin/app/<feature>/`
- [ ] Build data table with filtering/sorting
- [ ] Add detail view/modal for record inspection
- [ ] Implement real-time updates (Supabase Realtime)
- [ ] Add bulk operations if needed
- [ ] Implement access controls based on staff roles
- [ ] Add data visualization (charts, metrics)
- [ ] Test CRUD operations

## 6. Integration & Testing

- [ ] Test full flow: mobile → API → database → admin
- [ ] Verify real-time updates work (mobile/admin sync)
- [ ] Test error cases (validation, timeout, permission denied)
- [ ] Verify state transitions are atomic
- [ ] Load testing for high-transaction scenarios
- [ ] Mobile testing on real device if possible

## 7. Release & Documentation

- [ ] Create PR with all changes
- [ ] Update `docs/` with feature overview
- [ ] Update README if user-facing
- [ ] Write deployment notes (migrations first? backward compatible?)
- [ ] Plan rollback strategy
- [ ] Merge and deploy to staging first
