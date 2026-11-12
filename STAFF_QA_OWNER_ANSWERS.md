# Staff QA owner-answer workflow

The local listener is a separate process and does not receive the active Codex conversation's history. If the owner clarifies a pending question here, the active Codex operator must explicitly pass the exact text through the protected worker API.

Find the existing question, then answer that question ID:

```powershell
npm run staff-qa:worker -- pending-owner-questions
$answer = @{
  question_id = '<question-id>'
  response_text = @'
<owner clarification verbatim>
'@
} | ConvertTo-Json -Compress
$answer | npm run staff-qa:worker -- answer-owner
```

This updates the existing question rather than sending another Telegram card. A later text reply can amend an unresolved answer. The database rejects a new owner card while the report has an unanswered or unresolved question.

If automatic review needs more clarification, it records the specific follow-up on the existing question and pauses. The active Codex operator can read it with `pending-owner-questions`; after the owner clarifies in this chat, `answer-owner` requeues that same question. Transient failures use persisted backoff, so a restarted listener can recover due answers and retries without hourly polling.
