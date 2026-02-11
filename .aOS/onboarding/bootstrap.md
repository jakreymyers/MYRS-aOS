# aOS Onboarding Guide

You are an aOS agent helping a new user set up their personal AI workspace.
Follow these phases in order. Update the status below as you complete each phase.

## Onboarding Status

- [x] Phase 1: System Verification
- [x] Phase 2: Personalization Interview
- [x] Phase 3: Google Workspace Connection
- [x] Phase 4: Context Population
- [x] Phase 5: Verification & Handoff

If the user asks about the onboarding process, explain where they are,
what's next, and what will be expected of them at each phase.

---

## Phase 1: System Verification

Verify setup.sh was run successfully:
- Run `memory stats` — should succeed with 0 entities
- Check directory structure exists (context/, memory/, workspace/)
- Verify bun and dependencies are installed
- Run `.aOS/onboarding/verify-setup.sh` for a quick health check

If anything is missing, guide the user through fixing it.

When complete, mark Phase 1 done and proceed to Phase 2.

---

## Phase 2: Personalization Interview

Interview the user to understand who they are and how they want to work.
This generates two files: identity.md (agent persona) and user.md (user profile).

### Questions to explore:

**About the user:**
- Name, pronouns, timezone
- Role and organizational context (company, team, responsibilities)
- Typical schedule and availability
- Communication preferences (structured vs narrative, detail level, format)

**About the working relationship:**
- What should the agent handle autonomously vs collaboratively?
- What communication norms matter? (directness, pushback, etc.)
- What are the hard stops? (things that always need approval)

**About the agent persona:**
- What should the agent be called? (default: Exa)
- What role should it play? (default: Chief of Staff)
- Any tone/style preferences beyond the defaults?

### Interview approach:

Don't dump all questions at once. Have a natural conversation — start with who the user is,
then explore how they want to work, then customize the agent persona. Each topic builds on
the previous one. Use AskUserQuestion with structured options when it helps, and open
conversation for nuanced topics.

### Output:

Use the interview responses to generate:
- `prompts/aos-configuration/user.md` — structured profile
- `prompts/aos-configuration/identity.md` — agent persona

Read the template files at `.aOS/onboarding/templates/` for the expected structure and format.
Show the user what you generated and ask for feedback before saving.

Also generate an initial `prompts/aos-configuration/guardrails.md` from the defaults,
adjusting based on anything the user mentioned about approval preferences.

When complete, mark Phase 2 done and proceed to Phase 3.

---

## Phase 3: Google Workspace Connection

Walk the user through connecting Google Workspace via the gog CLI.

### Steps:

1. **Install gog CLI:**
   ```bash
   brew install steipete/tap/gogcli
   ```

2. **Create Google Cloud OAuth credentials** (if they don't have them):
   - Create a project (or use existing): https://console.cloud.google.com/projectcreate
   - Enable these APIs:
     - Gmail: https://console.cloud.google.com/apis/api/gmail.googleapis.com
     - Calendar: https://console.cloud.google.com/apis/api/calendar-json.googleapis.com
     - Drive: https://console.cloud.google.com/apis/api/drive.googleapis.com
     - People (Contacts): https://console.cloud.google.com/apis/api/people.googleapis.com
     - Sheets: https://console.cloud.google.com/apis/api/sheets.googleapis.com
   - Configure OAuth consent screen: https://console.cloud.google.com/auth/branding
   - Create OAuth client:
     - Go to https://console.cloud.google.com/auth/clients
     - Click "Create Client" → Application type: "Desktop app"
     - Download the JSON file (named `client_secret_....json`)

3. **Configure gog:**
   ```bash
   gog auth credentials /path/to/client_secret.json
   gog auth add user@example.com --services gmail,calendar,drive,contacts,docs,sheets
   ```

4. **Verify:**
   ```bash
   gog auth list
   gog gmail search "newer_than:1d" --max 3
   gog calendar events primary --from $(date -u +%Y-%m-%dT00:00:00Z) --to $(date -u +%Y-%m-%dT23:59:59Z)
   ```

If the user already has gog configured, skip to verification.
If the user wants to skip Google integration for now, that's fine — mark Phase 3 as skipped
and proceed to Phase 4 (context population will be limited to manual input).

When complete, mark Phase 3 done and proceed to Phase 4.

---

## Phase 4: Context Population

With the system configured (and optionally Google connected), explore the user's
existing digital life to seed their knowledge graph. This gives the system useful
context from day one instead of starting empty.

### Approach:

If Google is connected, use subagents to explore in parallel:

**Email exploration:**
- Search recent emails (30 days) to identify frequent contacts
- Look for project names, recurring topics, active threads
- Note organizational patterns (who reports to whom, key stakeholders)

**Calendar exploration:**
- Review upcoming and recent meetings (2 weeks back, 2 weeks forward)
- Identify recurring meetings and their attendees
- Map meeting patterns to projects and teams

**Drive exploration:**
- Search for recently modified documents
- Identify shared folders and team spaces
- Note key documents and their topics

If Google is NOT connected, interview the user instead:
- Ask about their team members and key stakeholders
- Ask about active projects
- Ask about companies/vendors they work with
- Ask about teams/departments they interact with

### Entity creation guidance:

From the exploration, create entities for:
- **People** — colleagues, stakeholders, frequent contacts
  - Path: `context/people/{first-last}/`
  - Include: role, relationship to user, communication patterns
- **Projects** — active work with clear goals
  - Path: `context/projects/{project-name}/`
  - Include: status, key stakeholders, recent activity
- **Companies** — organizations the user works with
  - Path: `context/areas/companies/{company-name}/`
  - Include: relationship type, key contacts
- **Teams/Departments** — organizational units
  - Path: `context/areas/{teams,departments}/{name}/`

Use the memory skill to invoke `memory entity create` for each entity.
Add 3-5 initial facts per entity.

After batch creation, run `memory vec sync` to index everything.

### Human validation:

After creating entities, present a summary to the user:
- How many entities created, by type
- List of people entities (user should verify these are real contacts)
- List of project entities (user should verify these are real projects)
- Ask: "Does this look right? Anyone missing? Anything wrong?"

Adjust based on feedback before proceeding.

When complete, mark Phase 4 done and proceed to Phase 5.

---

## Phase 5: Verification & Handoff

Guide the user through verifying everything works end-to-end.

### 5a. Memory System Verification
```bash
memory stats              # Shows entity counts, fact counts
memory search "test"      # Returns results from populated graph
memory entity list        # Lists all created entities
```

### 5b. Hook Verification

**This requires ending and starting a new session.**

Explain to the user:
1. "I'm going to end this session now. This will trigger the SessionEnd hook,
   which runs the extraction pipeline on our conversation."
2. "After the session ends, start a new Claude Code session in this directory."
3. "In the new session, ask the agent to check that hooks fired correctly."

In the new session, verify:
- SessionStart hook ran (`memory session-check` output in logs)
- Previous session was extracted (check `memory/daily-notes/` for today's entry)
- Vector index is current (`memory stats` shows indexed doc count)

### 5c. Google Integration Verification (if configured)
```bash
gog gmail search "newer_than:1d" --max 5
gog calendar events primary --from <today> --to <tomorrow>
```

### 5d. Transition to Production

1. Replace the bootstrap CLAUDE.md with the production version:
   - Read `.aOS/onboarding/CLAUDE.md.production` for the content
   - Write it to `CLAUDE.md`

2. Review and finalize `memory/MEMORY.md` — add any system-specific notes
   from the onboarding process.

3. Run final `memory vec sync` to ensure index is current.

4. Print onboarding summary:
   - Entities created (count by type)
   - Skills available
   - Google services connected (if applicable)
   - Next recommended action

When complete, mark Phase 5 done. The user's aOS is fully operational.
