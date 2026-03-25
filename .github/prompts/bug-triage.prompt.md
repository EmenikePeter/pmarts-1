---
name: "Bug Triage"
description: "Diagnose and trace issues across services (mobile/API/admin). Use when debugging production errors, integration failures, or unexpected behavior."
argument-hint: "Describe the bug, e.g. 'Mobile app can't complete transactions when offline'"
---

# Bug Triage & Root Cause Analysis

Systematic approach to diagnosing and fixing bugs in PMARTS.

## Step 1: Understand the Problem

- **What's happening?** (User action → unexpected result)
- **What should happen?** (Expected behavior)
- **Where does it fail?** (Mobile? API? Admin dashboard? Database?)
- **When did it start?** (Always? After recent deploy? Intermittent?)
- **How often?** (Every time? 50% of the time? Specific conditions?)
- **User impact?** (Blocking transactions? Data loss? Just UI glitch?)

**Example**: "User clicks 'Release Payment' on mobile, transaction stays in 'pending' state. API logs show 200 response. Admin dashboard shows disputed status. Started after latest mobile deploy."

## Step 2: Identify Affected Services

I'll explore these areas:
- [ ] **Mobile** — Check console logs, API call success/failure, state management
- [ ] **API** — Review route handler, database query results, logs
- [ ] **Admin** — Verify real-time updates, permissions/RLS
- [ ] **Database** — Check actual transaction state, any constraints violated
- [ ] **Telemetry** — Review error logs, metrics, Sentry alerts

## Step 3: Gather Evidence

- [ ] Error messages or stack traces?
  - [ ] From mobile console (react-native dev tools)?
  - [ ] From API logs (server-side)?
  - [ ] From browser console (admin dashboard)?
  
- [ ] Query results?
  - [ ] What does the database show for this transaction?
  - [ ] Any unusual values or NULL fields?
  
- [ ] Network traffic?
  - [ ] What API request was sent?
  - [ ] What was the response (status, body)?
  
- [ ] Timing?
  - [ ] When did this happen (timestamp)?
  - [ ] Any recent code changes or deploys?

## Step 4: Trace the Flow

Follow the data through the system:

1. **Mobile** → What API call is being made? With what parameters?
2. **API** → What route handler receives it? What database query runs?
3. **Database** → What's the current state? Are constraints preventing the update?
4. **Response** → What does the API return to mobile?
5. **Admin** → Does the admin see the correct state via real-time updates?

## Step 5: Identify Root Cause

Common culprits:
- **API bug** — Route handler logic error, incorrect query, missing validation
- **Database/RLS** — Permission denied, constraint violation, transaction rollback
- **Mobile** — Offline state not handled, stale state not refreshed
- **Timing** — Race condition between concurrent operations
- **Environment** — Staging vs production config difference
- **Type mismatch** — Frontend/backend type definitions out of sync

## Step 6: Implement Fix

- [ ] Locate problematic code (file, function, line)
- [ ] Write a test that reproduces the bug
- [ ] Fix the bug
- [ ] Verify test passes
- [ ] Check for similar bugs elsewhere in codebase
- [ ] Add safeguard checks if appropriate

## Step 7: Verify and Deploy

- [ ] Test fix locally
- [ ] Deploy to staging
- [ ] Verify bug is gone in staging
- [ ] Check for side effects (other features broken?)
- [ ] Deploy to production
- [ ] Monitor for new errors
- [ ] Update documentation if behavior changed
