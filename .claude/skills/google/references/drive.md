---
title: Drive CLI Reference
type: reference
domain: technical
created: 2026-02-05
updated: 2026-02-05
version: 1.0
status: final
summary: Comprehensive CLI reference for gog drive commands — list, search, upload, download, organize, share, permissions, comments, and shared drives.
---

# Drive CLI Reference

Complete command reference for `gog drive`.

## Listing & Searching

### List Files

```
gog drive ls [flags]
```

List files in a folder (default: root).

| Flag | Default | Description |
|------|---------|-------------|
| `--max` | `20` | Max results |
| `--page` | | Page token |
| `--query` | | Drive query filter |
| `--parent` | root | Folder ID to list |

```bash
# Root folder
gog drive ls

# Specific folder
gog drive ls --parent 1AbCdEfGhIjKlMnOp --max 50

# With Drive query filter
gog drive ls --query "mimeType='application/pdf'"

# JSON output
gog drive ls --json --max 100
```

### Search Files

```
gog drive search <query> [flags]
```

Full-text search across Drive.

| Flag | Default | Description |
|------|---------|-------------|
| `--max` | `20` | Max results |
| `--page` | | Page token |

```bash
# Simple text search
gog drive search "quarterly report"

# Search for specific file types
gog drive search "invoice" --max 50

# JSON for scripting
gog drive search "budget 2026" --json
```

**Drive search supports Google Drive query operators in the search string:**
- `name contains 'report'`
- File types in search: `"report filetype:pdf"`

### Get File Metadata

```
gog drive get <fileId>
```

```bash
gog drive get 1AbCdEfGhIjKlMnOp
gog drive get 1AbCdEfGhIjKlMnOp --json
```

### File URL

```
gog drive url <fileId> ...
```

Print Drive web URLs for one or more files.

```bash
gog drive url 1AbCdEfGhIjKlMnOp
```

---

## Upload & Download

### Upload

```
gog drive upload <localPath> [flags]
```

| Flag | Description |
|------|-------------|
| `--name` | Override filename |
| `--parent` | Destination folder ID |

```bash
# Upload to root
gog drive upload ./report.pdf

# Upload to specific folder with custom name
gog drive upload ./data.csv --parent 1AbCdEfGhIjKlMnOp --name "Q1-Data.csv"
```

### Download

```
gog drive download <fileId> [flags]
```

Downloads a file. For Google Docs formats (Docs, Sheets, Slides), exports in the specified format.

| Flag | Default | Description |
|------|---------|-------------|
| `--out` | config dir | Output file path |
| `--format` | auto | Export format: `pdf`, `csv`, `xlsx`, `pptx`, `txt`, `png`, `docx` |

```bash
# Download a binary file
gog drive download 1AbCdEfGhIjKlMnOp --out ./downloaded-file.pdf

# Export Google Doc as PDF
gog drive download 1AbCdEfGhIjKlMnOp --format pdf --out ./doc.pdf

# Export Google Doc as DOCX
gog drive download 1AbCdEfGhIjKlMnOp --format docx --out ./doc.docx

# Export Google Sheets as XLSX
gog drive download 1AbCdEfGhIjKlMnOp --format xlsx --out ./data.xlsx

# Export Slides as PPTX
gog drive download 1AbCdEfGhIjKlMnOp --format pptx --out ./deck.pptx
```

### Copy

```
gog drive copy <fileId> <name> [flags]
```

| Flag | Description |
|------|-------------|
| `--parent` | Destination folder ID |

```bash
gog drive copy 1AbCdEfGhIjKlMnOp "Report Copy"
gog drive copy 1AbCdEfGhIjKlMnOp "Report Copy" --parent 2BcDeFgHiJkLmNoP
```

---

## Organizing Files

### Create Folder

```
gog drive mkdir <name> [flags]
```

| Flag | Description |
|------|-------------|
| `--parent` | Parent folder ID |

```bash
gog drive mkdir "Project Alpha"
gog drive mkdir "Deliverables" --parent 1AbCdEfGhIjKlMnOp
```

### Rename

```
gog drive rename <fileId> <newName>
```

```bash
gog drive rename 1AbCdEfGhIjKlMnOp "Final Report v2"
```

### Move

```
gog drive move <fileId> [flags]
```

| Flag | Description |
|------|-------------|
| `--parent` | New parent folder ID (required) |

```bash
gog drive move 1AbCdEfGhIjKlMnOp --parent 2BcDeFgHiJkLmNoP
```

### Delete

```
gog drive delete <fileId>
```

Aliases: `rm`, `del`. Moves to trash (not permanent).

```bash
gog drive delete 1AbCdEfGhIjKlMnOp
```

---

## Sharing & Permissions

### Share

```
gog drive share <fileId> [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--email` | | Share with specific user |
| `--anyone` | | Make publicly accessible |
| `--role` | `reader` | Permission: `reader`, `writer` |
| `--discoverable` | | Allow file discovery in search (anyone/domain only) |

```bash
# Share with specific person (read-only)
gog drive share 1AbCdEfGhIjKlMnOp --email alice@company.com --role reader

# Share with edit access
gog drive share 1AbCdEfGhIjKlMnOp --email alice@company.com --role writer

# Make public (anyone with link)
gog drive share 1AbCdEfGhIjKlMnOp --anyone --role reader
```

### Unshare

```
gog drive unshare <fileId> <permissionId>
```

```bash
# First list permissions to get the permission ID
gog drive permissions 1AbCdEfGhIjKlMnOp

# Then remove specific permission
gog drive unshare 1AbCdEfGhIjKlMnOp 12345678901234567890
```

### List Permissions

```
gog drive permissions <fileId> [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--max` | `100` | Max results |
| `--page` | | Page token |

```bash
gog drive permissions 1AbCdEfGhIjKlMnOp
gog drive permissions 1AbCdEfGhIjKlMnOp --json
```

---

## Comments

### List Comments

```
gog drive comments list <fileId> [flags]
```

### Get Comment

```
gog drive comments get <fileId> <commentId>
```

### Create Comment

```
gog drive comments create <fileId> <content> [flags]
```

### Update Comment

```
gog drive comments update <fileId> <commentId> <content>
```

### Delete Comment

```
gog drive comments delete <fileId> <commentId>
```

### Reply to Comment

```
gog drive comments reply <fileId> <commentId> <content>
```

```bash
# List comments on a file
gog drive comments list 1AbCdEfGhIjKlMnOp

# Add a comment
gog drive comments create 1AbCdEfGhIjKlMnOp "Please review section 3"

# Reply to a comment
gog drive comments reply 1AbCdEfGhIjKlMnOp AAAABcDe "Done, updated."
```

---

## Shared Drives

### List Shared Drives

```
gog drive drives [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--max` | `100` | Max results (max allowed: 100) |
| `--page` | | Page token |
| `-q, --query` | | Search query for filtering shared drives |

```bash
gog drive drives
gog drive drives --max 50 --json
gog drive drives --query "name contains 'Engineering'"
```

---

## Global Flags

All `gog drive` commands accept these flags:

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

### Search and Download PDFs

```bash
gog --json drive search "invoice filetype:pdf" --max 20 | \
  jq -r '.files[] | .id' | \
  while read fileId; do
    gog drive download "$fileId" --out "./invoices/"
  done
```

### Organize Files into Folders

```bash
# Create folder
gog drive mkdir "Archive Q1"

# Get the folder ID from output, then move files
gog drive move 1AbCdEfGhIjKlMnOp --parent <new-folder-id>
```

### Share Workflow

```bash
# Upload file
gog drive upload ./presentation.pptx --parent 1AbCdEfGhIjKlMnOp

# Share with team
gog drive share <fileId> --email team@company.com --role writer

# Get shareable URL
gog drive url <fileId>
```
