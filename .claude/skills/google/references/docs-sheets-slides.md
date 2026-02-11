---
title: Docs, Sheets & Slides CLI Reference
type: reference
domain: technical
created: 2026-02-05
updated: 2026-02-05
version: 1.0
status: final
summary: Comprehensive CLI reference for gog docs, gog sheets, and gog slides commands — export, create, copy, read, write, format, and append.
---

# Docs, Sheets & Slides CLI Reference

Complete command reference for `gog docs`, `gog sheets`, and `gog slides`.

---

## Google Docs

### Export

```
gog docs export <docId> [flags]
```

Export a Google Doc to a local file.

| Flag | Default | Description |
|------|---------|-------------|
| `--out` | config dir | Output file path |
| `--format` | `pdf` | Export format: `pdf`, `docx`, `txt` |

```bash
gog docs export 1AbCdEfGhIjKlMnOp --format pdf --out ./report.pdf
gog docs export 1AbCdEfGhIjKlMnOp --format docx --out ./report.docx
gog docs export 1AbCdEfGhIjKlMnOp --format txt --out ./report.txt
```

### Cat (Read as Text)

```
gog docs cat <docId> [flags]
```

Print a Google Doc as plain text to stdout.

| Flag | Default | Description |
|------|---------|-------------|
| `--max-bytes` | `2000000` | Max bytes to read (0 = unlimited) |

```bash
# Print doc content
gog docs cat 1AbCdEfGhIjKlMnOp

# Limit size
gog docs cat 1AbCdEfGhIjKlMnOp --max-bytes 10000
```

### Info

```
gog docs info <docId>
```

Get Google Doc metadata (title, revision, etc).

```bash
gog docs info 1AbCdEfGhIjKlMnOp
gog docs info 1AbCdEfGhIjKlMnOp --json
```

### Create

```
gog docs create <title> [flags]
```

| Flag | Description |
|------|-------------|
| `--parent` | Destination folder ID |

```bash
gog docs create "Meeting Notes 2026-02-10"
gog docs create "Project Spec" --parent 1AbCdEfGhIjKlMnOp
```

### Copy

```
gog docs copy <docId> <title> [flags]
```

| Flag | Description |
|------|-------------|
| `--parent` | Destination folder ID |

```bash
gog docs copy 1AbCdEfGhIjKlMnOp "Report Template Copy"
gog docs copy 1AbCdEfGhIjKlMnOp "Report Copy" --parent 2BcDeFgHiJkLmNoP
```

**Note:** Google Docs does not support in-place editing via the CLI. Use `cat` to read content and `export` for file conversion. For in-place edits, use the Google Docs API directly.

---

## Google Sheets

### Get Values

```
gog sheets get <spreadsheetId> <range> [flags]
```

Read values from a spreadsheet range.

| Flag | Default | Description |
|------|---------|-------------|
| `--dimension` | | Major dimension: `ROWS` or `COLUMNS` |
| `--render` | | Value render: `FORMATTED_VALUE`, `UNFORMATTED_VALUE`, `FORMULA` |

```bash
# Read a range
gog sheets get 1AbCdEfGhIjKlMnOp 'Sheet1!A1:D10'

# JSON output
gog sheets get 1AbCdEfGhIjKlMnOp 'Sheet1!A1:D10' --json

# Get raw formulas
gog sheets get 1AbCdEfGhIjKlMnOp 'Sheet1!A1:D10' --render FORMULA

# Get unformatted values (numbers without currency symbols, etc.)
gog sheets get 1AbCdEfGhIjKlMnOp 'Sheet1!A1:D10' --render UNFORMATTED_VALUE

# Read columns instead of rows
gog sheets get 1AbCdEfGhIjKlMnOp 'Sheet1!A1:D10' --dimension COLUMNS
```

### Update Values

```
gog sheets update <spreadsheetId> <range> [<values>] [flags]
```

Write values to a range. Values can be provided inline or via JSON.

| Flag | Default | Description |
|------|---------|-------------|
| `--input` | `USER_ENTERED` | Value input: `RAW` or `USER_ENTERED` |
| `--values-json` | | Values as JSON 2D array |
| `--copy-validation-from` | | Copy data validation from an A1 range to updated cells |

**Value format (inline):** Rows separated by commas, cells within a row separated by pipes.

```bash
# Inline values (pipe = cell separator, comma = row separator)
gog sheets update 1AbCdEfGhIjKlMnOp 'Sheet1!A1' 'val1|val2,val3|val4'

# JSON values (recommended for complex data)
gog sheets update 1AbCdEfGhIjKlMnOp 'Sheet1!A1:B2' \
  --values-json '[["Name","Score"],["Alice","95"]]'

# RAW input (no formula parsing)
gog sheets update 1AbCdEfGhIjKlMnOp 'Sheet1!A1' \
  --values-json '[["=SUM(B1:B10)"]]' \
  --input RAW

# With validation copy
gog sheets update 1AbCdEfGhIjKlMnOp 'Sheet1!A1:C1' 'new|row|data' \
  --copy-validation-from 'Sheet1!A2:C2'
```

### Append Values

```
gog sheets append <spreadsheetId> <range> [<values>] [flags]
```

Append values after the last row in a range.

| Flag | Default | Description |
|------|---------|-------------|
| `--input` | `USER_ENTERED` | Value input: `RAW` or `USER_ENTERED` |
| `--insert` | | Insert mode: `OVERWRITE` or `INSERT_ROWS` |
| `--values-json` | | Values as JSON 2D array |
| `--copy-validation-from` | | Copy data validation from an A1 range to appended cells |

```bash
# Append a row (inline)
gog sheets append 1AbCdEfGhIjKlMnOp 'Sheet1!A:C' 'Alice|95|Pass'

# Append with INSERT_ROWS (shifts existing data down)
gog sheets append 1AbCdEfGhIjKlMnOp 'Sheet1!A:C' \
  --values-json '[["Bob","88","Pass"]]' \
  --insert INSERT_ROWS

# Append multiple rows
gog sheets append 1AbCdEfGhIjKlMnOp 'Sheet1!A:C' \
  --values-json '[["Charlie","92","Pass"],["Dave","78","Fail"]]'
```

### Clear Values

```
gog sheets clear <spreadsheetId> <range>
```

```bash
gog sheets clear 1AbCdEfGhIjKlMnOp 'Sheet1!A2:Z'
gog sheets clear 1AbCdEfGhIjKlMnOp 'Sheet1!B1:B100'
```

### Format Cells

```
gog sheets format <spreadsheetId> <range> [flags]
```

Apply cell formatting using the Sheets API CellFormat specification.

| Flag | Description |
|------|-------------|
| `--format-json` | Cell format as JSON (Sheets API CellFormat) |
| `--format-fields` | Format field mask |

```bash
# Bold text
gog sheets format 1AbCdEfGhIjKlMnOp 'Sheet1!A1:B2' \
  --format-json '{"textFormat":{"bold":true}}' \
  --format-fields 'userEnteredFormat.textFormat.bold'

# Background color (light yellow)
gog sheets format 1AbCdEfGhIjKlMnOp 'Sheet1!A1:D1' \
  --format-json '{"backgroundColor":{"red":1,"green":0.95,"blue":0.8}}' \
  --format-fields 'userEnteredFormat.backgroundColor'

# Number format (currency)
gog sheets format 1AbCdEfGhIjKlMnOp 'Sheet1!C2:C100' \
  --format-json '{"numberFormat":{"type":"CURRENCY","pattern":"$#,##0.00"}}' \
  --format-fields 'userEnteredFormat.numberFormat'

# Multiple format properties
gog sheets format 1AbCdEfGhIjKlMnOp 'Sheet1!A1:D1' \
  --format-json '{"textFormat":{"bold":true,"fontSize":14},"horizontalAlignment":"CENTER"}' \
  --format-fields 'userEnteredFormat(textFormat,horizontalAlignment)'
```

**Common format-fields masks:**
- `userEnteredFormat.textFormat.bold`
- `userEnteredFormat.textFormat.italic`
- `userEnteredFormat.textFormat.fontSize`
- `userEnteredFormat.backgroundColor`
- `userEnteredFormat.numberFormat`
- `userEnteredFormat.horizontalAlignment`
- `userEnteredFormat(textFormat,backgroundColor)` — multiple fields

### Metadata

```
gog sheets metadata <spreadsheetId>
```

Get spreadsheet metadata (title, sheet names, properties).

```bash
gog sheets metadata 1AbCdEfGhIjKlMnOp
gog sheets metadata 1AbCdEfGhIjKlMnOp --json
```

### Create Spreadsheet

```
gog sheets create <title> [flags]
```

| Flag | Description |
|------|-------------|
| `--sheets` | Comma-separated sheet names to create |

```bash
gog sheets create "Budget 2026"
gog sheets create "Project Tracker" --sheets "Tasks,Timeline,Resources"
```

### Copy Spreadsheet

```
gog sheets copy <spreadsheetId> <title> [flags]
```

| Flag | Description |
|------|-------------|
| `--parent` | Destination folder ID |

```bash
gog sheets copy 1AbCdEfGhIjKlMnOp "Budget 2026 Copy"
gog sheets copy 1AbCdEfGhIjKlMnOp "Template Instance" --parent 2BcDeFgHiJkLmNoP
```

### Export Spreadsheet

```
gog sheets export <spreadsheetId> [flags]
```

Export via Drive API.

| Flag | Default | Description |
|------|---------|-------------|
| `--out` | config dir | Output file path |
| `--format` | `xlsx` | Export format: `pdf`, `xlsx`, `csv` |

```bash
gog sheets export 1AbCdEfGhIjKlMnOp --format pdf --out ./budget.pdf
gog sheets export 1AbCdEfGhIjKlMnOp --format xlsx --out ./budget.xlsx
gog sheets export 1AbCdEfGhIjKlMnOp --format csv --out ./budget.csv
```

---

## Google Slides

### Export

```
gog slides export <presentationId> [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--out` | config dir | Output file path |
| `--format` | `pptx` | Export format: `pdf`, `pptx` |

```bash
gog slides export 1AbCdEfGhIjKlMnOp --format pptx --out ./deck.pptx
gog slides export 1AbCdEfGhIjKlMnOp --format pdf --out ./deck.pdf
```

### Info

```
gog slides info <presentationId>
```

```bash
gog slides info 1AbCdEfGhIjKlMnOp
gog slides info 1AbCdEfGhIjKlMnOp --json
```

### Create

```
gog slides create <title> [flags]
```

| Flag | Description |
|------|-------------|
| `--parent` | Destination folder ID |

```bash
gog slides create "Q1 Review Deck"
gog slides create "Sprint Demo" --parent 1AbCdEfGhIjKlMnOp
```

### Copy

```
gog slides copy <presentationId> <title> [flags]
```

| Flag | Description |
|------|-------------|
| `--parent` | Destination folder ID |

```bash
gog slides copy 1AbCdEfGhIjKlMnOp "Deck Template Copy"
```

---

## Global Flags

All commands accept these flags:

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

### Read Google Doc Content for Processing

```bash
# Get text content of a doc
gog docs cat 1AbCdEfGhIjKlMnOp

# Save to file for processing
gog docs cat 1AbCdEfGhIjKlMnOp > ./doc-content.txt
```

### Export All Formats

```bash
# Export a doc in all formats
gog docs export 1AbCdEfGhIjKlMnOp --format pdf --out ./doc.pdf
gog docs export 1AbCdEfGhIjKlMnOp --format docx --out ./doc.docx
gog docs export 1AbCdEfGhIjKlMnOp --format txt --out ./doc.txt
```

### Sheets: Read, Process, Write Back

```bash
# Read current data
gog sheets get 1AbCdEfGhIjKlMnOp 'Sheet1!A1:D10' --json

# Write processed results
gog sheets update 1AbCdEfGhIjKlMnOp 'Sheet1!E1:E10' \
  --values-json '[["Result"],["Pass"],["Fail"],["Pass"],["Pass"],["Fail"],["Pass"],["Pass"],["Pass"],["Fail"]]'
```

### Create Sheet from CSV

```bash
# Create new spreadsheet
gog sheets create "Import Data" --sheets "Raw"

# Convert CSV and write (pipe = cell separator, comma = row separator)
cat data.csv | tr ',' '|' | gog sheets update <newSpreadsheetId> 'Raw!A1'
```

### Template Workflow

```bash
# Copy a template
gog docs copy 1AbCdEfGhIjKlMnOp "Client Report - Acme Corp" --parent 2BcDeFgHiJkLmNoP

# Export the copy
gog docs export <newDocId> --format pdf --out ./acme-report.pdf
```
