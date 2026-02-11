---
title: Calendar CLI Reference
type: reference
domain: technical
created: 2026-02-05
updated: 2026-02-05
version: 1.0
status: final
summary: Comprehensive CLI reference for gog calendar commands — events, create, update, delete, freebusy, conflicts, respond, team calendars, focus time, OOO, and working location.
---

# Calendar CLI Reference

Complete command reference for `gog calendar`.

## Listing & Reading

### List Calendars

```
gog calendar calendars [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--max` | `100` | Max results |
| `--page` | | Page token |

```bash
gog calendar calendars
gog calendar calendars --json
```

### List Events

```
gog calendar events [<calendarId>] [flags]
```

Alias: `gog calendar list`. Calendar ID defaults to `primary`.

| Flag | Default | Description |
|------|---------|-------------|
| `--from` | | Start time (RFC3339, date, or relative: `today`, `tomorrow`, `monday`) |
| `--to` | | End time (RFC3339, date, or relative) |
| `--today` | | Today only (timezone-aware) |
| `--tomorrow` | | Tomorrow only (timezone-aware) |
| `--week` | | This week (uses `--week-start`, default Mon) |
| `--days` | `0` | Next N days (timezone-aware) |
| `--week-start` | | Week start day for `--week` (`sun`, `mon`, ...) |
| `--max` | `10` | Max results |
| `--page` | | Page token |
| `--query` | | Free text search |
| `--all` | | Fetch events from all calendars |
| `--private-prop-filter` | | Filter by private extended property (`key=value`) |
| `--shared-prop-filter` | | Filter by shared extended property (`key=value`) |
| `--fields` | | Comma-separated fields to return |
| `--weekday` | | Include start/end day-of-week columns |

```bash
# Today's events
gog calendar events --today

# This week
gog calendar events --week

# Next 3 days
gog calendar events --days 3

# Specific date range with relative dates
gog calendar events --from today --to friday

# Specific date range (absolute)
gog calendar events --from 2026-02-10T00:00:00Z --to 2026-02-15T00:00:00Z

# All calendars
gog calendar events --all --today

# With day-of-week columns
gog calendar events --week --weekday

# Specific calendar
gog calendar events work@company.com --today

# JSON output for scripting
gog calendar events --today --json
```

**Tip:** Set `GOG_CALENDAR_WEEKDAY=1` to enable `--weekday` by default.

### Get Single Event

```
gog calendar event <calendarId> <eventId>
```

Alias: `gog calendar get`.

```bash
gog calendar event primary abc123def

# JSON includes timezone + localized times
gog calendar event primary abc123def --json
```

**JSON event output includes convenience fields:**
```json
{
  "event": {
    "id": "...",
    "summary": "Team Sync",
    "startDayOfWeek": "Friday",
    "endDayOfWeek": "Friday",
    "timezone": "America/Los_Angeles",
    "eventTimezone": "America/New_York",
    "startLocal": "2026-01-23T20:45:00-08:00",
    "endLocal": "2026-01-23T22:45:00-08:00"
  }
}
```

### Search Events

```
gog calendar search <query> [flags]
```

Defaults to 30 days ago through 90 days ahead unless you set time flags.

| Flag | Default | Description |
|------|---------|-------------|
| `--from` | | Start time (RFC3339, date, or relative) |
| `--to` | | End time (RFC3339, date, or relative) |
| `--today` | | Today only |
| `--tomorrow` | | Tomorrow only |
| `--week` | | This week |
| `--days` | `0` | Next N days |
| `--week-start` | | Week start day |
| `--calendar` | `primary` | Calendar ID |
| `--max` | `25` | Max results |

```bash
gog calendar search "standup" --today
gog calendar search "1:1" --week
gog calendar search "sprint" --days 30 --max 50
```

---

## Creating Events

### Create Event

```
gog calendar create <calendarId> [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--summary` | | Event title |
| `--from` | | Start time (RFC3339) |
| `--to` | | End time (RFC3339) |
| `--description` | | Description |
| `--location` | | Location |
| `--attendees` | | Comma-separated attendee emails |
| `--all-day` | | All-day event (use date-only in `--from`/`--to`) |
| `--rrule` | | Recurrence rules (repeatable) |
| `--reminder` | | Custom reminders as `method:duration` (repeatable, max 5) |
| `--event-color` | | Color ID 1–11 (see `gog calendar colors`) |
| `--visibility` | | `default`, `public`, `private`, `confidential` |
| `--transparency` | | `opaque` (busy) or `transparent` (free). Aliases: `busy`, `free` |
| `--send-updates` | `all` | Notification mode: `all`, `externalOnly`, `none` |
| `--guests-can-invite` | | Allow guests to invite others |
| `--guests-can-modify` | | Allow guests to modify event |
| `--guests-can-see-others` | | Allow guests to see other guests |
| `--with-meet` | | Create a Google Meet conference |
| `--source-url` | | Source URL |
| `--source-title` | | Source title |
| `--attachment` | | File attachment URL (repeatable) |
| `--private-prop` | | Private extended property `key=value` (repeatable) |
| `--shared-prop` | | Shared extended property `key=value` (repeatable) |
| `--event-type` | `default` | Event type: `default`, `focus-time`, `out-of-office`, `working-location` |

**Focus Time flags** (when `--event-type focus-time`):

| Flag | Default | Description |
|------|---------|-------------|
| `--focus-auto-decline` | | `none`, `all`, `new` |
| `--focus-decline-message` | | Decline message |
| `--focus-chat-status` | | `available`, `doNotDisturb` |

**Out of Office flags** (when `--event-type out-of-office`):

| Flag | Default | Description |
|------|---------|-------------|
| `--ooo-auto-decline` | | `none`, `all`, `new` |
| `--ooo-decline-message` | | Decline message |

**Working Location flags** (when `--event-type working-location`):

| Flag | Description |
|------|-------------|
| `--working-location-type` | `home`, `office`, `custom` |
| `--working-office-label` | Office name/label |
| `--working-building-id` | Building ID |
| `--working-floor-id` | Floor ID |
| `--working-desk-id` | Desk ID |
| `--working-custom-label` | Custom label |

```bash
# Simple event
gog calendar create primary \
  --summary "Team Standup" \
  --from 2026-02-10T10:00:00-08:00 \
  --to 2026-02-10T10:30:00-08:00

# With attendees and location
gog calendar create primary \
  --summary "Sprint Planning" \
  --from 2026-02-10T14:00:00-08:00 \
  --to 2026-02-10T15:00:00-08:00 \
  --attendees "alice@company.com,bob@company.com" \
  --location "Zoom" \
  --with-meet

# All-day event
gog calendar create primary \
  --summary "Company Holiday" \
  --from 2026-02-17 \
  --to 2026-02-18 \
  --all-day

# Recurring with reminders
gog calendar create primary \
  --summary "Monthly Payment" \
  --from 2026-02-11T09:00:00-08:00 \
  --to 2026-02-11T09:15:00-08:00 \
  --rrule "RRULE:FREQ=MONTHLY;BYMONTHDAY=11" \
  --reminder "email:3d" \
  --reminder "popup:30m"

# With color
gog calendar create primary \
  --summary "Important" \
  --from 2026-02-10T09:00:00-08:00 \
  --to 2026-02-10T10:00:00-08:00 \
  --event-color 11

# Silent creation (no notifications)
gog calendar create primary \
  --summary "Placeholder" \
  --from 2026-02-10T12:00:00-08:00 \
  --to 2026-02-10T13:00:00-08:00 \
  --send-updates none
```

---

## Updating Events

### Update Event

```
gog calendar update <calendarId> <eventId> [flags]
```

Accepts the same flags as `create` plus:

| Flag | Default | Description |
|------|---------|-------------|
| `--add-attendee` | | Comma-separated emails to add (preserves existing attendees/RSVP) |
| `--scope` | `all` | For recurring: `single`, `future`, `all` |
| `--original-start` | | Original start time (required for `scope=single,future`) |

All fields are optional — only provided fields are updated. Set a field to empty string to clear it.

```bash
# Reschedule
gog calendar update primary abc123def \
  --from 2026-02-10T11:00:00-08:00 \
  --to 2026-02-10T12:00:00-08:00

# Add attendees without replacing existing
gog calendar update primary abc123def \
  --add-attendee "charlie@company.com,dave@company.com"

# Change color
gog calendar update primary abc123def --event-color 7

# Update single instance of recurring event
gog calendar update primary abc123def \
  --scope single \
  --original-start 2026-02-11T09:00:00-08:00 \
  --summary "Rescheduled Payment"

# Notify only external attendees
gog calendar update primary abc123def \
  --summary "Updated Title" \
  --send-updates externalOnly
```

---

## Deleting Events

### Delete Event

```
gog calendar delete <calendarId> <eventId> [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--scope` | `all` | For recurring: `single`, `future`, `all` |
| `--original-start` | | Original start time (required for `scope=single,future`) |

```bash
gog calendar delete primary abc123def

# Delete single instance of recurring
gog calendar delete primary abc123def \
  --scope single \
  --original-start 2026-02-11T09:00:00-08:00
```

---

## Invitations & Availability

### Respond to Invitation

```
gog calendar respond <calendarId> <eventId> [flags]
```

| Flag | Description |
|------|-------------|
| `--status` | `accepted`, `declined`, `tentative`, `needsAction` |
| `--comment` | Optional comment/note |

```bash
gog calendar respond primary abc123def --status accepted
gog calendar respond primary abc123def --status declined --comment "Conflict with another meeting"
gog calendar respond primary abc123def --status tentative
```

### Propose New Time

```
gog calendar propose-time <calendarId> <eventId> [flags]
```

Browser-only flow (API limitation) — generates a URL.

| Flag | Description |
|------|-------------|
| `--open` | Open URL in browser automatically |
| `--decline` | Also decline the event |
| `--comment` | Comment (implies `--decline`) |

```bash
gog calendar propose-time primary abc123def
gog calendar propose-time primary abc123def --open
gog calendar propose-time primary abc123def --decline --comment "Can we do 5pm instead?"
```

### Free/Busy

```
gog calendar freebusy <calendarIds> [flags]
```

| Flag | Description |
|------|-------------|
| `--from` | Start time (RFC3339, required) |
| `--to` | End time (RFC3339, required) |

```bash
gog calendar freebusy "primary,colleague@company.com" \
  --from 2026-02-10T00:00:00-08:00 \
  --to 2026-02-11T00:00:00-08:00
```

### Find Conflicts

```
gog calendar conflicts [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--from` | | Start time (RFC3339, date, or relative) |
| `--to` | | End time (RFC3339, date, or relative) |
| `--today` | | Today only |
| `--week` | | This week |
| `--days` | `0` | Next N days |
| `--week-start` | | Week start day |
| `--calendars` | `primary` | Comma-separated calendar IDs |

```bash
gog calendar conflicts --today
gog calendar conflicts --week --calendars "primary,work@company.com"
```

---

## Special Event Types

### Focus Time

```
gog calendar focus-time --from=STRING --to=STRING [<calendarId>] [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--summary` | `Focus Time` | Title |
| `--from` | | Start time (RFC3339) |
| `--to` | | End time (RFC3339) |
| `--auto-decline` | `all` | `none`, `all`, `new` |
| `--decline-message` | | Decline message |
| `--chat-status` | `doNotDisturb` | `available`, `doNotDisturb` |
| `--rrule` | | Recurrence rules (repeatable) |

```bash
gog calendar focus-time \
  --from 2026-02-10T13:00:00-08:00 \
  --to 2026-02-10T15:00:00-08:00

gog calendar focus-time \
  --summary "Deep Work" \
  --from 2026-02-10T08:00:00-08:00 \
  --to 2026-02-10T10:00:00-08:00 \
  --auto-decline all \
  --chat-status doNotDisturb
```

### Out of Office

```
gog calendar out-of-office --from=STRING --to=STRING [<calendarId>] [flags]
```

Alias: `ooo`.

| Flag | Default | Description |
|------|---------|-------------|
| `--summary` | `Out of office` | Title |
| `--from` | | Start date/datetime |
| `--to` | | End date/datetime |
| `--auto-decline` | `all` | `none`, `all`, `new` |
| `--decline-message` | `I am out of office...` | Decline message |
| `--all-day` | | Create as all-day event |

```bash
gog calendar out-of-office \
  --from 2026-02-20 \
  --to 2026-02-21 \
  --all-day

gog calendar ooo \
  --summary "Vacation" \
  --from 2026-03-01 \
  --to 2026-03-08 \
  --all-day \
  --decline-message "On vacation. Back March 8."
```

### Working Location

```
gog calendar working-location --from=STRING --to=STRING --type=STRING [<calendarId>] [flags]
```

Alias: `wl`.

| Flag | Description |
|------|-------------|
| `--from` | Start date (YYYY-MM-DD) |
| `--to` | End date (YYYY-MM-DD) |
| `--type` | `home`, `office`, `custom` |
| `--office-label` | Office name/label |
| `--building-id` | Building ID |
| `--floor-id` | Floor ID |
| `--desk-id` | Desk ID |
| `--custom-label` | Custom location label |

```bash
gog calendar working-location \
  --type home \
  --from 2026-02-10 \
  --to 2026-02-11

gog calendar working-location \
  --type office \
  --office-label "HQ" \
  --from 2026-02-12 \
  --to 2026-02-13
```

---

## Team & Utility

### Team Calendar

```
gog calendar team <group-email> [flags]
```

Show events for all members of a Google Group. Requires Cloud Identity API.

| Flag | Default | Description |
|------|---------|-------------|
| `--freebusy` | | Show only busy/free blocks (faster) |
| `-q, --query` | | Filter by event title (case-insensitive) |
| `--max` | `100` | Max events per calendar |
| `--no-dedup` | | Show each person's view without dedup |
| `--from` | | Start time |
| `--to` | | End time |
| `--today` | | Today only |
| `--tomorrow` | | Tomorrow only |
| `--week` | | This week |
| `--days` | `0` | Next N days |
| `--week-start` | | Week start day |

```bash
gog calendar team engineering@company.com --today
gog calendar team engineering@company.com --week --freebusy
gog calendar team engineering@company.com --today --query "standup"
```

### ACL

```
gog calendar acl <calendarId>
```

List access control rules for a calendar.

### Colors

```
gog calendar colors
```

Show available event/calendar color IDs (1–11).

| ID | Color |
|----|-------|
| 1 | #a4bdfc (Lavender) |
| 2 | #7ae7bf (Sage) |
| 3 | #dbadff (Grape) |
| 4 | #ff887c (Flamingo) |
| 5 | #fbd75b (Banana) |
| 6 | #ffb878 (Tangerine) |
| 7 | #46d6db (Peacock) |
| 8 | #e1e1e1 (Graphite) |
| 9 | #5484ed (Blueberry) |
| 10 | #51b749 (Basil) |
| 11 | #dc2127 (Tomato) |

### Time

```
gog calendar time [flags]
```

| Flag | Description |
|------|-------------|
| `--timezone` | Timezone (IANA name) |

```bash
gog calendar time
gog calendar time --timezone UTC
```

### Workspace Users

```
gog calendar users [flags]
```

List workspace users (use their email as calendar ID).

---

## Global Flags

All `gog calendar` commands accept these flags:

| Flag | Description |
|------|-------------|
| `--account <email\|alias>` | Account to use (overrides `GOG_ACCOUNT`) |
| `--client <name>` | OAuth client name |
| `--json` | JSON output to stdout |
| `--plain` | Stable TSV output (no colors) |
| `--force` | Skip confirmations |
| `--no-input` | Never prompt; fail instead |
| `--verbose` | Verbose logging |

---

## Common Patterns

### Find Free Slot and Book

```bash
# Check availability
gog calendar freebusy "primary" \
  --from 2026-02-10T00:00:00-08:00 \
  --to 2026-02-11T00:00:00-08:00

# Create if slot is free
gog calendar create primary \
  --summary "Team Sync" \
  --from 2026-02-10T10:00:00-08:00 \
  --to 2026-02-10T10:30:00-08:00 \
  --attendees "alice@company.com,bob@company.com"
```

### Weekly Schedule Overview

```bash
gog calendar events --week --all --weekday --json | jq '.events[] | {summary, start: .startLocal, end: .endLocal}'
```
