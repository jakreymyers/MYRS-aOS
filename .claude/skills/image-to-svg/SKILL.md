---
name: image-to-svg
description: >
  Convert raster images (PNG, JPG) to clean, production-ready SVG using
  Potrace and VTracer. Covers preprocessing, parameter tuning, post-processing,
  and visual verification for logos, icons, text, silhouettes, and illustrations.
metadata:
  author: exa
  version: "1.0"
allowed-tools: Bash(python3:*), Bash(potrace:*), Bash(pip:*)
---

# Image-to-SVG Skill

## When to Use

Activate when the user wants to: convert an image to SVG, vectorize a raster graphic, trace a logo/icon, make a scalable version of a bitmap, or any "raster to vector" request.

**Triggers:** "convert to SVG", "vectorize", "trace this image", "make an SVG from", logo/icon conversion, "I need a vector version".

## Tools

### Potrace — Gold Standard for B&W Tracing

```bash
brew install potrace   # macOS
```

- Produces compact Bezier SVGs (2-15KB typical)
- Requires PBM input — must preprocess with PIL
- Excellent corner control via `alphamax`
- Best for: logos, icons, line art, text, any monochrome graphic

### VTracer — Color-Capable Alternative

```bash
pip install vtracer
```

- Handles color natively, no preprocessing needed
- Produces larger files (5-10x Potrace for equivalent image)
- Python API and CLI, Rust-based
- Best for: color images, quick conversions, when preprocessing is impractical

### When to Pick Each

| Scenario | Tool | Why |
|----------|------|-----|
| B&W logo, icon, text | **Potrace** | Smallest output, best edge quality |
| Color image/illustration | **VTracer** | Native color, no preprocessing |
| Quick one-off, any type | **VTracer** | Zero preprocessing, one-liner |
| Maximum quality B&W | **Potrace** | Fine-grained control, compact output |
| Batch processing mixed types | **VTracer** | Handles everything without branching |

## The Pipeline (Decision Tree)

For any input image, walk through this tree:

```
Input Image
├─ Color image? ──────────────────────── VTracer (colormode='color')
├─ Quick conversion, quality not critical? ── VTracer (colormode='binary')
│
└─ B&W, maximum quality needed? ──────── Potrace pipeline:
   │
   ├─ Has alpha channel?
   │  └─ Composite onto BLACK background first
   │
   ├─ White subject on dark/transparent?
   │  └─ Invert (ImageOps.invert) after grayscale
   │
   ├─ High-res (>1000px) with clean edges?
   │  └─ Threshold only, no blur. Trace directly.
   │
   ├─ Low-res (<500px)?
   │  └─ Upscale 4x with LANCZOS, light blur (radius = scale * 0.5)
   │
   ├─ Fuzzy/anti-aliased edges?
   │  └─ Gaussian blur radius 6-8, threshold 140
   │
   ├─ Geometric (sharp angles)?
   │  └─ alphamax 0.3, opttolerance 3.0
   │
   ├─ Organic (flowing curves)?
   │  └─ alphamax 0.8, opttolerance 5.0
   │
   └─ General purpose
      └─ alphamax 0.6, opttolerance 5.0
```

## Preprocessing Reference (PIL/Pillow)

All preprocessing uses inline Python. Run via `python3 -c '...'` or write a temp script.

### Alpha Compositing onto Black Background

```python
from PIL import Image
img = Image.open('input.png').convert('RGBA')
bg = Image.new('RGBA', img.size, (0, 0, 0, 255))
composite = Image.alpha_composite(bg, img)
composite = composite.convert('RGB')
```

### Grayscale + Invert (for White-on-Dark Images)

```python
from PIL import Image, ImageOps
img = Image.open('input.png').convert('RGBA')
bg = Image.new('RGBA', img.size, (0, 0, 0, 255))
composite = Image.alpha_composite(bg, img).convert('L')
inverted = ImageOps.invert(composite)
```

### Upscale Low-Res Images

```python
from PIL import Image
img = Image.open('input.png')
scale = 4
new_size = (img.width * scale, img.height * scale)
upscaled = img.resize(new_size, Image.LANCZOS)
```

### Gaussian Blur

Choose radius based on image quality:
- **Clean, high-res source:** skip blur entirely
- **Light smoothing:** radius 2-3
- **Fuzzy/anti-aliased edges:** radius 6-8
- **After upscaling:** radius = scale_factor * 0.5

```python
from PIL import ImageFilter
blurred = img.filter(ImageFilter.GaussianBlur(radius=6))
```

### Threshold to Binary

- **128** — Clean, high-contrast source
- **140** — Fuzzy or anti-aliased edges
- **180** — Light gray backgrounds that need to be knocked out

```python
binary = blurred.point(lambda x: 255 if x > 140 else 0, '1')
```

### Save to PBM (Potrace Input)

```python
binary.save('output.pbm')
```

### Complete Preprocessing Pipeline Example

White logo on transparent background, organic shapes:

```python
from PIL import Image, ImageOps, ImageFilter

img = Image.open('logo.png').convert('RGBA')
bg = Image.new('RGBA', img.size, (0, 0, 0, 255))
composite = Image.alpha_composite(bg, img).convert('L')
inverted = ImageOps.invert(composite)
blurred = inverted.filter(ImageFilter.GaussianBlur(radius=6))
binary = blurred.point(lambda x: 255 if x > 140 else 0, '1')
binary.save('/tmp/trace-input.pbm')
```

### Masking Unwanted Regions (Watermarks, etc.)

```python
from PIL import Image, ImageDraw
img = Image.open('input.png')
draw = ImageDraw.Draw(img)
# Paint over watermark region with background color
draw.rectangle([x1, y1, x2, y2], fill=0)  # 0 for black in grayscale
```

## Potrace Reference

```bash
potrace -s -a 0.6 -O 5.0 -t 10 -o output.svg input.pbm
```

### Arguments

| Flag | Name | What it does | Values |
|------|------|-------------|--------|
| `-s` | svg | Output SVG format | Always use |
| `-a N` | alphamax | Corner detection. 0=all corners, 1.334=all curves | **0.3** geometric, **0.6** mixed, **0.8** organic |
| `-O N` | opttolerance | Curve optimization. Higher=fewer points | **3.0** detailed, **5.0** smooth |
| `-t N` | turdsize | Speckle removal. Remove blobs < N pixels | **5** small img, **10-15** large img |
| `-n` | nopt | Disable curve optimization | Debug only |
| `-o F` | output | Output file path | Always specify |

### Potrace Output Quirks

Potrace outputs SVG with `pt` units and a `scale(0.1)` transform. This causes:
- Browser rendering at wrong scale (very large)
- Width/height attributes like `width="264pt" height="328pt"`

**Always post-process** the SVG to fix this (see next section).

## SVG Post-Processing

After Potrace output, apply these fixes:

### Fix Units (Required)

Remove `pt` suffix from width/height attributes:

```python
import re
svg = open('output.svg').read()
svg = re.sub(r'width="([\d.]+)pt"', r'width="\1"', svg)
svg = re.sub(r'height="([\d.]+)pt"', r'height="\1"', svg)
open('output.svg', 'w').write(svg)
```

### Change Fill Color

For white output (most logos):

```python
svg = svg.replace('fill="#000000"', 'fill="#ffffff"')
```

### Remove Unwanted Paths

Inspect the SVG for stray paths (watermark remnants, background rectangles). The last `<path>` element is often a simple bounding rectangle — remove it if unwanted:

```python
# Remove last path element if it's a simple rectangle
import re
paths = list(re.finditer(r'<path[^/]*/>', svg))
if paths:
    last_path = paths[-1].group()
    # Check if it's a simple rectangle (few commands)
    if last_path.count('C') < 3:
        svg = svg.replace(last_path, '')
```

### Trim ViewBox (Optional)

Crop SVG to content bounds if there's excess whitespace.

## VTracer Reference

### Python API

```python
import vtracer

# Binary mode (B&W)
vtracer.convert_image_to_svg_py(
    'input.png',
    'output.svg',
    colormode='binary',
    filter_speckle=4,
    corner_threshold=60,
    length_threshold=4.0,
    splice_threshold=45,
)

# Color mode
vtracer.convert_image_to_svg_py(
    'input.png',
    'output.svg',
    colormode='color',
    hierarchical='stacked',
    filter_speckle=4,
    color_precision=6,
    layer_difference=16,
    corner_threshold=60,
    length_threshold=4.0,
    splice_threshold=45,
)
```

### Key Parameters

| Parameter | What it does | Default | Tuning |
|-----------|-------------|---------|--------|
| `colormode` | `'binary'` or `'color'` | `'color'` | Use binary for B&W |
| `filter_speckle` | Remove small blobs (px) | 4 | Increase for noisy images |
| `corner_threshold` | Corner detection (degrees) | 60 | Lower = more corners |
| `length_threshold` | Minimum path segment length | 4.0 | Higher = simpler output |
| `color_precision` | Color clustering precision | 6 | Lower = fewer colors |
| `hierarchical` | `'stacked'` or `'cutout'` | `'stacked'` | Stacked for layered output |

## Preview & Verification

### Playwright (Recommended)

The most reliable method for visual verification. Renders SVG at correct aspect ratio with appropriate background:

```python
from playwright.sync_api import sync_playwright
import re

svg_content = open('output.svg').read()

# Make SVG responsive
svg_content = re.sub(r'width="[\d.]+(?:pt)?"', 'width="100%"', svg_content)
svg_content = re.sub(r'height="[\d.]+(?:pt)?"', 'height="auto"', svg_content)

# Determine background (dark for white SVGs, white for black SVGs)
bg_color = '#1a1a2e'  # dark background for white/light SVGs
# bg_color = '#ffffff'  # white background for dark SVGs

html = f'''<!DOCTYPE html>
<html><body style="margin:0;background:{bg_color};display:flex;
align-items:center;justify-content:center;min-height:100vh">
<div style="width:80%;max-width:600px">{svg_content}</div>
</body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={{"width": 800, "height": 600}})
    page.set_content(html)
    page.screenshot(path='/tmp/svg-preview.png')
    browser.close()
```

Then read the screenshot with the Read tool to visually inspect.

### qlmanage (Quick but Limited)

```bash
qlmanage -t -s 800 -o /tmp output.svg
```

**Limitations:** Always produces square thumbnails, crops wide/tall SVGs. Use Playwright for accurate previews.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Wavy/wobbly edges | Low-res source or fuzzy edges | Upscale 4x + blur before tracing |
| Rounded corners on geometric shapes | alphamax too high or blur too aggressive | Lower alphamax (0.3), reduce blur radius |
| Chunky/stepped edges | Aggressive downscaling | Keep intermediate resolution at 800px+ |
| Dithering artifacts | mkbitmap preprocessing | Skip mkbitmap, use PIL threshold directly |
| Gray fringing | VTracer color mode on anti-aliased B&W | Use binary mode or switch to Potrace |
| SVG too large (100KB+) | VTracer on high-res, or no optimization | Use Potrace, or increase filter_speckle |
| Inverted colors | Source is white-on-black/transparent | `ImageOps.invert()` after grayscale conversion |
| Watermark in output | Unmasked element in source | Mask with ImageDraw, or remove path from SVG |
| SVG renders tiny/huge in browser | Potrace pt units | Remove pt suffix from width/height attributes |
| Loss of fine detail | blur radius too large | Reduce blur, or skip blur for clean sources |
| Too many control points | opttolerance too low | Increase to 5.0+ |

## Tool Comparison

| Dimension | Potrace | VTracer |
|-----------|---------|---------|
| Input format | PBM only (needs preprocessing) | PNG/JPG directly |
| Color support | B&W only | Full color + binary mode |
| Output size | 2-15KB typical | 10-200KB typical |
| Edge quality | Excellent Bezier curves | Good, slightly noisier |
| Corner control | `alphamax` (precise) | `corner_threshold` (degrees) |
| Install | `brew install potrace` | `pip install vtracer` |
| Best for | Logos, icons, text, line art | Color images, quick conversions |
| Preprocessing | Required (PIL pipeline) | None needed |
| Actively maintained | Stable, mature | Yes (v0.6.12, Feb 2026) |
