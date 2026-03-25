Support API & DB deployment checklist

1) Build and deploy the server API
- Ensure the API commit that includes `api/src/routes/support.js` is pushed to your deployment branch.
- On the server host, pull the latest code and install deps, then restart the service (example using systemd):

```bash
git pull origin main
cd api
npm ci
npm run build    # if applicable
sudo systemctl restart pmarts-api.service
```

2) Apply database migrations (run in staging first)
- Migrations to apply:
  - 035_create_support_messages.sql
  - 036_backfill_messages.sql
  - 037_create_support_typing.sql

- Using psql (replace connection string):

```bash
psql "postgresql://USER:PASS@HOST:PORT/DBNAME" -f migrations/035_create_support_messages.sql
psql "postgresql://USER:PASS@HOST:PORT/DBNAME" -f migrations/036_backfill_messages.sql
psql "postgresql://USER:PASS@HOST:PORT/DBNAME" -f migrations/037_create_support_typing.sql
```

- If you use Supabase CLI:

```bash
supabase db push --schema path/to/migrations
```

3) Verify backfill and realtime
- Run queries to confirm `support_ticket_messages` has expected rows and indexes:

```sql
SELECT COUNT(*) FROM support_ticket_messages;
SELECT * FROM support_ticket_messages WHERE ticket_id = '<example>' ORDER BY created_at DESC LIMIT 10;
```

- Confirm `support_typing` table has been created and test insert:

```sql
INSERT INTO support_typing (ticket_id, user_id, updated_at) VALUES ('<ticket>', '<user>', now());
```

4) Test end-to-end on staging
- Start mobile app against staging API.
- Create ticket, send messages from mobile, confirm messages appear in admin UI and mobile via realtime channels.
- Validate typing indicators and presence work.

5) Roll out to production
- After staging verification, repeat steps 1-4 against production, and monitor logs for errors.

Notes
- Backfill migration may be long-running; run during low traffic window and monitor DB IO.
- Ensure the API uses a service-role Supabase key for admin ops and that RLS policies are correctly configured for `support_ticket_messages` insertion by the server.
- If the server echoes a `client_id` for optimistic message reconciliation, ensure client uses it to dedupe.

Contact
- If you need help applying migrations or running checks, tell me your hosting environment (Heroku, DigitalOcean, Supabase, etc.) and I can produce exact commands.