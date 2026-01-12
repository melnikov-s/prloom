# Workflows

## Plan Lifecycle

```
inbox/plan.md                    
     │ status: draft             
     │                           
     ▼ (user queues)             
inbox/plan.md                    
     │ status: queued            
     │                           
     ▼ (dispatcher ingests)      
worktree/prloom/.local/plan.md   
     │ status: active            
     │ + branch created          
     │ + draft PR opened         
     │                           
     ▼ (TODOs executed)          
     │ status: active            
     │ commits pushed            
     │                           
     ▼ (all TODOs done)          
     │ status: review            
     │ PR marked ready           
     │                           
     ▼ (feedback → triage)       
     │ status: triaging          
     │ new TODOs added           
     │                           
     ▼ (back to active)          
     │ status: active            
     │                           
     ▼ (PR merged)               
     plan removed from state     
```

## Status Transitions

| From | To | Trigger |
|------|----|---------|
| draft | queued | User runs `prloom queue <id>` |
| queued | active | Dispatcher ingests plan |
| active | review | All TODOs completed |
| active | triaging | New feedback received |
| triaging | active | Triage complete |
| review | active | New TODOs added from feedback |
| any | blocked | Error or explicit block |

## Blocking

Plans can be blocked by:
- TODO marked with `[b]` (explicit block marker)
- TODO failing 3 times consecutively
- Triage agent errors
- Rebase conflicts

Unblock with `prloom unpause <id>`.

## Agent Stages

| Stage | Purpose | Config key |
|-------|---------|------------|
| designer | Creates plan from user description | `agents.<name>.designer` |
| worker | Executes individual TODOs | `agents.<name>.worker` |
| triage | Processes PR feedback into TODOs | `agents.<name>.triage` |
