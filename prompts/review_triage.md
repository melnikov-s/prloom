# Review Triage

You are processing PR feedback for an active plan. Your job is to:

1. **Classify** each feedback item by type
2. **Respond** appropriately based on the type
3. **Update** the plan if changes are needed
4. Detect if a rebase was requested

## Feedback to Process

{{feedback}}

## Current Plan

{{plan}}

---

## Step 1: Classify Each Feedback Item

Before acting, identify the type of each feedback item:

| Type                | Description                                   | Action                   |
| ------------------- | --------------------------------------------- | ------------------------ |
| **Question**        | Asking "why", "how", or seeking clarification | Answer in reply, NO TODO |
| **Change Request**  | Asking for code modifications                 | Create specific TODO     |
| **Approval/Praise** | Positive feedback, LGTM, approval             | Acknowledge briefly      |
| **Process Request** | Rebase, update branch, etc.                   | Set flag, acknowledge    |

## Step 2: Handle Each Type

### Questions → Answer Directly

For questions, **answer them substantively in your reply**:

- Explore the codebase to find the answer if needed
- Explain the reasoning behind implementation decisions
- Reference specific code locations or commits if helpful
- Do NOT create a TODO like "answer the question" - just answer it

Example question: "Why did you use a polling approach instead of webhooks?"
→ Reply with the actual reasoning, don't create a TODO.

### Change Requests → Create TODOs

For explicit requests to modify code:

- Edit the plan file directly to add actionable TODOs
- Add them at the end of the ## TODO section
- Use the format: `- [ ] Specific actionable task`
- Do NOT create vague tasks like "Address review comments"
- Create SPECIFIC tasks like:
  - "Update function X to handle null input"
  - "Add test for Y edge case"
  - "Rename Z for clarity"
- Group related requests into single tasks when logical
- If the plan status is `done` and you add TODOs, change status to `active`

### Approval/Praise → Acknowledge

Simply thank the reviewer in your reply. No TODO needed.

### Process Requests → Set Flag

If any comment mentions rebase, update branch, or similar:

- Set `rebase_requested: true` in the result file
- Acknowledge in your reply

## Step 3: Write the Result File

After processing, you MUST write `{{result_path}}`:

```json
{
  "reply_markdown": "## Triage Response\n\nThank you for your feedback...",
  "rebase_requested": false
}
```

**Required fields:**

- `reply_markdown`: Your response to post on the PR (ALWAYS required)
- `rebase_requested`: Set to `true` if rebase was requested

### Reply Guidelines

- Be polite and professional
- **Answer questions directly** - this is the most important part
- Explain what TODOs were created (if any)
- If a request doesn't require changes, explain why
- Keep it concise but complete

## Critical Rules

1. You MUST write `{{result_path}}` even if you add no TODOs
2. The result file must contain valid JSON only, no markdown wrapper
3. Failure to write the result file will mark the plan as blocked
4. **Questions should be answered, not converted to TODOs**
