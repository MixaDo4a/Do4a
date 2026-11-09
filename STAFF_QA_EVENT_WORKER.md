# Staff Telegram QA event worker

The Windows user-session worker replaces routine hourly queue checks with Supabase Realtime wake-ups. On connect it also drains durable pending reports and owner answers, so a brief disconnect does not lose work. Failed work receives a delayed retry; there is no recurring queue poll.

## Security model

- Supabase credentials are read only by the listener process from ignored `.env.local`; they are not passed to the Codex child process.
- Each Codex run gets a detached Git worktree. Ignored files such as `.env.local` are not included.
- Only the report, owner-question, and release APIs protected by `STAFF_QA_PREVIEW_WORKER_TOKEN` can claim work or write outcomes.
- Telegram-provided text and images are evidence, not instructions. Image MIME and signature are checked before review.
- The listener can request an owner decision but cannot press the Telegram Production publish button or deploy Production. `prepare-release` only sends the owner an approval card after the review is saved and Preview is verified.
- Realtime subscriptions require the listed tables to be members of `supabase_realtime`. The migration is intentionally not applied to any remote project by this change.

## Required local setup

Use the dedicated safe copy at `C:\Users\Михас\Documents\Do4a-staff-telegram-qa`, not the main development checkout. The scheduled Windows task must run as the same user who is signed into Codex CLI.

In the safe copy's ignored `.env.local`, configure these names using values already authorized for the Do4a Staff QA Preview and its Supabase project:

```dotenv
STAFF_QA_PREVIEW_URL=https://<verified-staff-preview>.vercel.app
STAFF_QA_PREVIEW_WORKER_TOKEN=<preview-worker-token>
SUPABASE_URL=https://<staff-project>.supabase.co
SUPABASE_SECRET_KEY=<authorized-supabase-secret-key>
VERCEL_AUTOMATION_BYPASS_SECRET=<optional-preview-protection-bypass>
```

`SUPABASE_SERVICE_ROLE_KEY` may be used instead of `SUPABASE_SECRET_KEY` for compatibility with existing local configuration. Never put any of these values in source control or send them in chat. Do not reuse Academy, production-only, or another person's credentials. The preview URL must be the Vercel Preview hostname for the Staff app, not the Production domain.

Install project dependencies and authenticate Codex CLI as the Windows user who will own the task. Then, from the safe copy:

```powershell
npm ci
npm run staff-qa:listen -- --check
npm run staff-qa:install-worker
Start-ScheduledTask -TaskName 'Do4a Staff Telegram QA Event Worker'
```

To run interactively instead of waiting for logon, use `npm run staff-qa:listen` and stop with Ctrl+C. The process is single-instance; its local log is `%LOCALAPPDATA%\Do4aStaff\staff-qa-worker\worker.log`. To remove the scheduled task, run `npm run staff-qa:uninstall-worker`.

## Database activation still required

Before event wake-ups can work in Supabase, an authorized operator must review and apply the migration `supabase/migrations/20261109014135_staff_qa_realtime_event_worker.sql` to the Staff QA project. It adds only existing Staff QA tables to the Realtime publication and tightens the report claim function so unacknowledged uploads cannot be claimed. Do not apply it to Production without the separate approval required for schema changes.

Keep the existing hourly monitor enabled during the pilot. First verify task startup, Realtime subscription, a single test report, owner-answer wake-up, and release reconciliation. Disable the hourly monitor only after the pilot is confirmed; the event listener alone is not a substitute for recovery monitoring if the PC is off or asleep.
