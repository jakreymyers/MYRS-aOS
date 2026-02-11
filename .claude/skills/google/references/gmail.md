---
title: Gmail CLI Reference
type: reference
domain: technical
created: 2026-02-05
updated: 2026-02-05
version: 1.0
status: final
summary: Comprehensive CLI reference for gog gmail commands — search, send, threads, labels, drafts, batch ops, filters, delegation, watch, and tracking.
---

# Gmail CLI Reference

Complete command reference for `gog gmail` (aliases: `mail`, `email`).

## Search & Read

### Search Threads

```
gog gmail search <query> [flags]
```

Search threads using Gmail query syntax. Returns one row per thread (most recent message date by default).

| Flag | Default | Description |
|------|---------|-------------|
| `--max` | `10` | Max results |
| `--page` | | Page token for pagination |
| `--oldest` | | Show first message date instead of last |
| `-z, --timezone` | local | Output timezone (IANA name, e.g. `America/New_York`, `UTC`) |
| `--local` | | Use local timezone (override `--timezone`) |

**Gmail query syntax examples:**
- `newer_than:7d` — last 7 days
- `from:alice@example.com` — from specific sender
- `is:unread` — unread only
- `has:attachment` — with attachments
- `in:inbox` — in inbox
- `subject:"meeting notes"` — subject match
- `label:important` — by label
- `older_than:1y` — older than 1 year
- `after:2026/01/01 before:2026/02/01` — date range

```bash
# Recent emails
gog gmail search 'newer_than:7d' --max 20

# From specific sender with attachments
gog gmail search 'from:boss@company.com has:attachment' --max 5

# Unread in inbox
gog gmail search 'in:inbox is:unread' --max 50

# With JSON output for scripting
gog gmail search 'newer_than:1d' --json
```

### Search Messages (Individual)

```
gog gmail messages search <query> [flags]
```

Returns one row per message (ignores threading). Use when you need every individual email.

| Flag | Default | Description |
|------|---------|-------------|
| `--max` | `10` | Max results |
| `--page` | | Page token |
| `-z, --timezone` | local | Output timezone |
| `--local` | | Use local timezone |
| `--include-body` | | Include decoded message body (JSON is full; text is truncated) |

```bash
# Per-message search with bodies
gog gmail messages search "in:inbox from:noreply@github.com" --max 10 --include-body

# JSON output with body content
gog gmail messages search 'newer_than:1d' --max 5 --include-body --json
```

### Get Message

```
gog gmail get <messageId> [flags]
```

Get a single message by ID.

| Flag | Default | Description |
|------|---------|-------------|
| `--format` | `full` | Message format: `full`, `metadata`, `raw` |
| `--headers` | | Metadata headers (comma-separated; only for `--format=metadata`) |

```bash
# Full message
gog gmail get 18f1a2b3c4d5e6f7

# Metadata only (faster)
gog gmail get 18f1a2b3c4d5e6f7 --format metadata

# Specific headers only
gog gmail get 18f1a2b3c4d5e6f7 --format metadata --headers "From,Subject,Date"
```

### Get Thread

```
gog gmail thread get <threadId> [flags]
```

Get a thread with all messages, optionally downloading attachments.

| Flag | Default | Description |
|------|---------|-------------|
| `--download` | | Download attachments |
| `--full` | | Show full message bodies |
| `--out-dir` | `.` | Directory for downloaded attachments |

```bash
# Read thread with full bodies
gog gmail thread get 18f1a2b3c4d5e6f7 --full

# Download all attachments to specific directory
gog gmail thread get 18f1a2b3c4d5e6f7 --download --out-dir ./attachments
```

### Thread Attachments

```
gog gmail thread attachments <threadId> [flags]
```

List (or download) all attachments in a thread.

| Flag | Default | Description |
|------|---------|-------------|
| `--download` | | Download all attachments |
| `--out-dir` | `.` | Directory for downloaded attachments |

```bash
# List attachments
gog gmail thread attachments 18f1a2b3c4d5e6f7

# Download all
gog gmail thread attachments 18f1a2b3c4d5e6f7 --download --out-dir ./downloads
```

### Download Single Attachment

```
gog gmail attachment <messageId> <attachmentId> [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--out` | config dir | Output file path |
| `--name` | | Filename (only when `--out` is empty) |

```bash
gog gmail attachment 18f1a2b3c4d5e6f7 ANGjdJ8xyz --out ./report.pdf
```

### Thread URL

```
gog gmail url <threadId> ...
```

Print Gmail web URLs for one or more threads.

```bash
gog gmail url 18f1a2b3c4d5e6f7
```

### History

```
gog gmail history [flags]
```

Get Gmail history (changes since a history ID).

| Flag | Default | Description |
|------|---------|-------------|
| `--since` | | Start history ID (required) |
| `--max` | `100` | Max results |
| `--page` | | Page token |

```bash
gog gmail history --since 12345678
```

---

## Send & Compose

### Send Email

```
gog gmail send [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--to` | | Recipients (comma-separated; required unless `--reply-all`) |
| `--cc` | | CC recipients (comma-separated) |
| `--bcc` | | BCC recipients (comma-separated) |
| `--subject` | | Subject (required) |
| `--body` | | Body (plain text; required unless `--body-html` is set) |
| `--body-file` | | Body file path (plain text; `'-'` for stdin) |
| `--body-html` | | Body (HTML; optional — sends multipart if both plain and HTML) |
| `--reply-to-message-id` | | Reply to Gmail message ID (sets In-Reply-To/References and thread) |
| `--thread-id` | | Reply within a Gmail thread (uses latest message for headers) |
| `--reply-all` | | Auto-populate recipients from original message (requires `--reply-to-message-id` or `--thread-id`) |
| `--reply-to` | | Reply-To header address |
| `--attach` | | Attachment file path (repeatable) |
| `--from` | | Send-as alias (must be verified) |
| `--track` | | Enable open tracking (requires tracking setup) |
| `--track-split` | | Send tracked messages separately per recipient |

**Body handling notes:**
- `--body` does NOT unescape `\n`. For inline newlines use a heredoc or `$'Line 1\n\nLine 2'`.
- `--body-file` reads from a file or stdin (`-`).
- `--body-html` sends HTML. If both `--body` and `--body-html` are set, a multipart message is sent.

```bash
# Simple send
gog gmail send --to alice@example.com --subject "Quick update" --body "All good."

# Multi-line via stdin
gog gmail send --to alice@example.com --subject "Follow-up" --body-file - <<'EOF'
Hi Alice,

Here are the action items from today's meeting:
- Finalize the proposal by Friday
- Schedule the follow-up call

Best,
Jak
EOF

# HTML email
gog gmail send --to alice@example.com \
  --subject "Formatted Update" \
  --body-html "<p>Hi Alice,</p><p>Please review the <strong>attached report</strong>.</p>"

# Reply to a specific message
gog gmail send --to alice@example.com \
  --subject "Re: Project Update" \
  --body "Thanks, looks good." \
  --reply-to-message-id 18f1a2b3c4d5e6f7

# Reply-all within a thread
gog gmail send --subject "Re: Team Sync" \
  --body "Agreed." \
  --thread-id 18f1a2b3c4d5e6f7 \
  --reply-all

# With attachment
gog gmail send --to alice@example.com \
  --subject "Report" \
  --body "See attached." \
  --attach ./report.pdf --attach ./data.xlsx

# Send from alias
gog gmail send --to client@external.com \
  --subject "Invoice" \
  --body "Attached." \
  --from billing@company.com
```

---

## Drafts

### List Drafts

```
gog gmail drafts list [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--max` | `20` | Max results |
| `--page` | | Page token |

### Get Draft

```
gog gmail drafts get <draftId> [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--download` | | Download draft attachments |

### Create Draft

```
gog gmail drafts create [flags]
```

Accepts the same composition flags as `send`: `--to`, `--cc`, `--bcc`, `--subject`, `--body`, `--body-file`, `--body-html`, `--reply-to-message-id`, `--reply-to`, `--attach`, `--from`.

```bash
# Simple draft
gog gmail drafts create --to alice@example.com --subject "Draft proposal" --body "WIP"

# Draft via stdin
gog gmail drafts create --to team@company.com \
  --subject "Weekly Summary" \
  --body-file - <<'EOF'
Team,

This week's highlights:
- Shipped v2.1
- Fixed 12 bugs

EOF
```

### Update Draft

```
gog gmail drafts update <draftId> [flags]
```

Same flags as `create`. Omit `--to` to keep existing recipients.

```bash
gog gmail drafts update r1234567890 --subject "Updated Subject" --body "New body content"
```

### Send Draft

```
gog gmail drafts send <draftId>
```

```bash
gog gmail drafts send r1234567890
```

### Delete Draft

```
gog gmail drafts delete <draftId>
```

---

## Labels

### List Labels

```
gog gmail labels list
```

### Get Label

```
gog gmail labels get <labelIdOrName>
```

Returns label details including message/thread counts.

```bash
gog gmail labels get INBOX --json
```

### Create Label

```
gog gmail labels create <name>
```

```bash
gog gmail labels create "Project/Alpha"
```

### Modify Thread Labels

```
gog gmail labels modify <threadId> ... [flags]
```

| Flag | Description |
|------|-------------|
| `--add` | Labels to add (comma-separated, name or ID) |
| `--remove` | Labels to remove (comma-separated, name or ID) |

```bash
# Archive and star
gog gmail labels modify 18f1a2b3c4d5e6f7 --remove INBOX --add STARRED

# Apply custom label
gog gmail labels modify 18f1a2b3c4d5e6f7 --add "Project/Alpha"
```

---

## Thread Operations

### Modify Thread Labels (via thread subcommand)

```
gog gmail thread modify <threadId> [flags]
```

| Flag | Description |
|------|-------------|
| `--add` | Labels to add (comma-separated) |
| `--remove` | Labels to remove (comma-separated) |

```bash
gog gmail thread modify 18f1a2b3c4d5e6f7 --add STARRED --remove INBOX
```

---

## Batch Operations

### Batch Delete

```
gog gmail batch delete <messageId> ...
```

Permanently deletes multiple messages. **Irreversible.**

```bash
gog gmail batch delete 18f1a2b3 17e1d2c3 16d1c2b3
```

### Batch Modify

```
gog gmail batch modify <messageId> ... [flags]
```

| Flag | Description |
|------|-------------|
| `--add` | Labels to add (comma-separated) |
| `--remove` | Labels to remove (comma-separated) |

```bash
# Mark multiple as read
gog gmail batch modify 18f1a2b3 17e1d2c3 --remove UNREAD

# Star multiple
gog gmail batch modify 18f1a2b3 17e1d2c3 --add STARRED
```

**Batch processing pattern (with JSON + jq):**

```bash
# Archive all emails from a sender
gog --json gmail search 'from:noreply@example.com' --max 200 | \
  jq -r '.threads[].id' | \
  xargs -n 50 gog gmail labels modify --remove INBOX

# Mark old emails read
gog --json gmail search 'older_than:30d is:unread' --max 200 | \
  jq -r '.threads[].id' | \
  xargs -n 50 gog gmail labels modify --remove UNREAD
```

---

## Settings & Admin

All settings commands live under `gog gmail settings`.

### Filters

```bash
gog gmail settings filters list
gog gmail settings filters get <filterId>
gog gmail settings filters create [flags]
gog gmail settings filters delete <filterId>
```

```bash
# Create a filter
gog gmail settings filters create --from 'noreply@example.com' --add-label 'Notifications'
```

### Delegates (Workspace)

```bash
gog gmail settings delegates list
gog gmail settings delegates get <delegateEmail>
gog gmail settings delegates add <delegateEmail>
gog gmail settings delegates remove <delegateEmail>
```

### Forwarding

```bash
gog gmail settings forwarding list
gog gmail settings forwarding get <forwardingEmail>
gog gmail settings forwarding create <forwardingEmail>
gog gmail settings forwarding delete <forwardingEmail>
```

### Auto-Forward

```bash
gog gmail settings autoforward get
gog gmail settings autoforward update [flags]
```

### Send-As Aliases

```bash
gog gmail settings sendas list
gog gmail settings sendas get <email>
gog gmail settings sendas create <email> [flags]
gog gmail settings sendas update <email> [flags]
gog gmail settings sendas verify <email>
gog gmail settings sendas delete <email>
```

### Vacation Responder

```bash
gog gmail settings vacation get
gog gmail settings vacation update [flags]
```

```bash
# Enable vacation responder
gog gmail settings vacation update --enable \
  --subject "Out of office" \
  --message "I'm away until Feb 10. For urgent matters contact backup@company.com."

# Disable
gog gmail settings vacation update --disable
```

---

## Watch (Pub/Sub Push)

Real-time Gmail notifications via Google Pub/Sub.

```bash
# Start watching
gog gmail settings watch start --topic projects/<project>/topics/<topic> --label INBOX

# Check status
gog gmail settings watch status

# Renew watch
gog gmail settings watch renew

# Stop watching
gog gmail settings watch stop

# Run push handler server
gog gmail settings watch serve --bind 127.0.0.1 --token <shared> --hook-url http://127.0.0.1:18789/hooks/agent
gog gmail settings watch serve --bind 0.0.0.0 --verify-oidc --oidc-email <svc@...> --hook-url <url>
```

---

## Email Tracking

Track when recipients open emails using a Cloudflare Worker backend.

### Setup

```bash
gog gmail track setup --worker-url https://gog-email-tracker.<acct>.workers.dev
```

### Send with Tracking

```bash
gog gmail send --to recipient@example.com \
  --subject "Proposal" \
  --body-html "<p>Please review.</p>" \
  --track
```

**Notes:**
- `--track` requires exactly 1 recipient (no cc/bcc) and an HTML body (`--body-html`).
- Use `--track-split` to send per-recipient tracked messages when there are multiple recipients.

### Check Opens

```bash
gog gmail track opens <tracking_id>
gog gmail track opens --to recipient@example.com
```

### Status

```bash
gog gmail track status
```

---

## Global Flags

All `gog gmail` commands accept these flags:

| Flag | Description |
|------|-------------|
| `--account <email\|alias>` | Account to use (overrides `GOG_ACCOUNT`) |
| `--client <name>` | OAuth client name |
| `--json` | JSON output to stdout |
| `--plain` | Stable TSV output (no colors) |
| `--force` | Skip confirmations |
| `--no-input` | Never prompt; fail instead (CI mode) |
| `--verbose` | Verbose logging |

---

## Common Patterns

### Pagination

```bash
# First page
gog gmail search 'newer_than:30d' --max 10

# Output includes: # Next page: --page <token>
gog gmail search 'newer_than:30d' --max 10 --page <token>
```

### JSON Piping

```bash
# Get thread IDs for scripting
gog --json gmail search 'from:alerts@monitoring.com' --max 100 | jq -r '.threads[].id'

# Get message details
gog --json gmail messages search 'newer_than:1d' --max 5 --include-body | jq '.messages[]'
```
