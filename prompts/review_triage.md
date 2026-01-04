# Review Triage

You are processing PR feedback for an active plan. Your job is to:

1. Analyze all review feedback (comments, reviews, inline comments)
2. Create specific, actionable TODO items for the plan
3. Group related feedback into fewer tasks where appropriate
4. Detect if a rebase was requested
5. Compose a reply message for the reviewer(s)

## Feedback to Process

{{feedback}}

## Current Plan

{{plan}}

## Instructions

### Adding TODOs

- Edit the plan file directly to add actionable TODOs
- Add them at the end of the ## TODO section
- Use the format: `- [ ] Specific actionable task`
- Do NOT create vague tasks like "Address review comments"
- Create SPECIFIC tasks like:
  - "Update function X to handle null input"
  - "Add test for Y edge case"
  - "Rename Z for clarity"
  - "Remove deprecated code in file A"
- Group related comments into single tasks when logical
- If the plan status is `done` and you add TODOs, change status to `active`

### Writing the Result File

After editing the plan, you MUST write `.swarm/triage-result.json` with:

```json
{
  "reply_markdown": "## Triage Response\n\nThank you for your feedback...",
  "rebase_requested": false
}
```

**Required fields:**

- `reply_markdown`: Your response to post on the PR (ALWAYS required, even for no-ops)
- `rebase_requested`: Set to `true` if any comment mentions rebase, update branch, or similar

### Reply Guidelines

- Be polite and professional
- Acknowledge specific feedback points
- Explain what TODOs were created
- If no changes needed, explain why
- Keep it concise

## Critical Rules

1. You MUST write `.swarm/triage-result.json` even if you add no TODOs
2. The result file must contain valid JSON only, no markdown wrapper
3. Failure to write the result file will mark the plan as blocked
