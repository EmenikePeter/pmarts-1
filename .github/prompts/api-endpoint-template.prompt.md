---
name: "API Endpoint Template"
description: "Design and validate a new API endpoint before coding. Use when planning REST endpoints for transactions, disputes, or other features."
argument-hint: "Describe the endpoint purpose, e.g. 'Create dispute appeal request'"
---

# API Endpoint Design

Let me help you design a new API endpoint with validation before implementation.

## Step 1: Define the Endpoint

- **HTTP Method**: (GET, POST, PUT, PATCH, DELETE)
- **URL Path**: (e.g., `/api/v1/disputes/{id}/appeals`)
- **Purpose**: (What action does this perform?)
- **Request Body**: (If POST/PUT, what data is required?)
- **Response**: (What does success return? What about errors?)
- **Authentication**: (Required? Which roles can access?)
- **Idempotency**: (Is this operation idempotent? How to handle retries?)

## Step 2: Validate Design

I'll check:
- [ ] Does this fit PMARTS REST conventions? (Correct HTTP method, path structure)
- [ ] Are request/response bodies consistent with existing endpoints?
- [ ] Does this require database migrations or schema changes?
- [ ] What database queries will this trigger? (Can we optimize with indexes?)
- [ ] Are there permission/RLS concerns? (Who should access this data?)
- [ ] How will the mobile app and admin dashboard consume this?
- [ ] Are there error cases we need to handle? (Validation, conflicts, timeout)

## Step 3: Implementation Plan

Once validated, I'll provide:
1. **Route handler** — Express.js route with proper error handling
2. **Type definitions** — Request/response TypeScript interfaces
3. **Database queries** — Optimized SQL or Supabase client calls
4. **Migration** — Any schema changes needed
5. **Tests** — Integration test cases (happy path + errors)
6. **Documentation** — OpenAPI spec snippet or endpoint docs
