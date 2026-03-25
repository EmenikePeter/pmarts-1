---
name: "Database Migration Template"
description: "Safely modify database schema without data loss. Use when adding/removing columns, creating indexes, or changing RLS policies."
argument-hint: "Describe the schema change needed, e.g. 'Add dispute_appeal_count column to disputes table'"
---

# Database Migration Workflow

Safe, reversible database schema changes following PMARTS standards.

## Step 1: Plan the Migration

- **What's changing?** (tables, columns, indexes, RLS policies?)
- **Why?** (new feature, bug fix, optimization?)
- **Impact?** (Does this break existing queries? Affects mobile/admin?)
- **Backward compatibility?** (Can new and old code run simultaneously?)
- **Data preservation?** (Migrating/transforming existing data?)

## Step 2: Create Migration File

**File location**: `supabase/migrations/<number>_<description>.sql`

**Example**: `supabase/migrations/040_add_dispute_appeal_count.sql`

**Format**:
```sql
-- Up: New functionality
CREATE TABLE ...
ALTER TABLE ...
CREATE INDEX ...

-- Down: Rollback to previous state
DROP TABLE ...
ALTER TABLE ...
DROP INDEX ...
```

## Step 3: Implementation Checklist

- [ ] **Idempotent operations** — Use `IF NOT EXISTS` / `IF EXISTS` to handle re-runs
- [ ] **Data preservation** — No `DROP TABLE` without backing up data first
- [ ] **RLS policies** — New tables must have RLS enabled and policies defined
- [ ] **Indexes** — Add indexes for frequently queried columns
- [ ] **Foreign keys** — Enforce relationships with `ON DELETE` behavior
- [ ] **Documentation** — Comment on complex logic or business rules
- [ ] **Down section** — Reversible rollback (test down migration works)

## Step 4: Testing

- [ ] Run migration up successfully
- [ ] Verify schema changes with `\\d tablename` (if using psql)
- [ ] Verify data integrity (count rows before/after)
- [ ] Run migration down successfully
- [ ] Verify rollback works and data is restored
- [ ] Check for any dependent queries that might break

## Step 5: Deployment

- [ ] Merge migration to `main` first
- [ ] Deploy migration to staging (`supabase db push` in staging env)
- [ ] Run against staging data for 24 hours minimum
- [ ] Verify mobile/admin still work correctly
- [ ] Deploy to production
- [ ] Monitor for errors during prod migration
- [ ] Keep rollback plan ready (previous migration number)

## Safety Reminders

❌ **Never**:
- Drop tables with live data (backup first)
- Use non-idempotent operations (`CREATE TABLE` without `IF NOT EXISTS`)
- Skip RLS policies for sensitive data
- Forget to test rollback

✅ **Always**:
- Test up AND down migrations
- Include data preservation logic
- Use helpful comments
- Keep migrations small and focused
- Review for performance (indexes needed?)
