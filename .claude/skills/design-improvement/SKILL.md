---
name: design-improvement
description: Self-improving visual design loop for web interfaces. Combines design philosophy creation, frontend aesthetic guidelines, and automated screenshot-based critique cycles using Playwright. Use this skill when refining the visual quality of HTML pages, presentations, dashboards, or any web UI — iterating through capture, critique, improve, verify cycles until the result meets a high standard of craftsmanship.
license: Internal skill — synthesized from canvas-design, frontend-design, and webapp-testing skills.
---

# Design Improvement Loop

A systematic approach to elevating web interface quality through automated visual inspection and iterative refinement. This skill combines design philosophy, frontend aesthetics expertise, and Playwright-powered screenshot capture into a self-improving loop.

## When to Use

- Refining an HTML presentation, landing page, dashboard, or any web UI
- The interface exists and renders but needs visual polish, better composition, or stronger aesthetic identity
- You want to systematically evaluate and improve every screen/slide/view
- You need to verify that CSS/HTML changes actually look correct

## The Loop

```
┌─────────────────────────────────────────────────┐
│  1. CAPTURE — Screenshot all views/slides       │
│  2. CRITIQUE — Visually assess each screenshot  │
│  3. PRIORITIZE — Rank issues by impact          │
│  4. IMPROVE — Make targeted CSS/HTML changes    │
│  5. VERIFY — Re-screenshot changed views        │
│  6. REPEAT — Until quality bar is met           │
└─────────────────────────────────────────────────┘
```

Run at least 2-3 full cycles. Each cycle should produce measurable visual improvement.

---

## Phase 1: Design Philosophy (run once, before first loop)

Before any improvement cycle, establish or confirm the design philosophy. If one doesn't exist, create it.

### How to Create a Design Philosophy

**Name the movement** (1-2 words): e.g., "Luminous Precision" / "Chromatic Silence" / "Brutalist Joy"

**Articulate the philosophy** in 4-6 paragraphs covering:
- Space and form — how elements occupy and relate to space
- Color and material — the chromatic language and surface quality
- Scale and rhythm — size relationships and visual tempo
- Composition and balance — spatial arrangements and visual weight
- Visual hierarchy — how the eye moves through the design

**Craftsmanship emphasis**: The philosophy MUST stress that the final work should appear as though it took countless hours, was labored over with care, and comes from someone at the absolute top of their field. Use phrases like "meticulously crafted," "painstaking attention," "master-level execution."

Save the philosophy as a `.md` file alongside the project for reference.

---

## Phase 2: Capture Screenshots

Write a Playwright script to capture every view/slide/state of the interface.

### Static HTML Files

```python
from playwright.sync_api import sync_playwright
import os

HTML_FILE = '/absolute/path/to/file.html'
OUTPUT_DIR = '/absolute/path/to/screenshots'
os.makedirs(OUTPUT_DIR, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})
    page.goto(f'file://{HTML_FILE}')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)  # Wait for fonts and animations

    # For slide-based presentations:
    for i in range(TOTAL_SLIDES):
        page.wait_for_timeout(1500)  # Wait for entry animations
        page.screenshot(path=f'{OUTPUT_DIR}/slide-{i+1:02d}.png')
        if i < TOTAL_SLIDES - 1:
            page.keyboard.press('ArrowRight')

    # For scrolling pages:
    # page.screenshot(path=f'{OUTPUT_DIR}/full.png', full_page=True)

    browser.close()
```

### Dynamic Web Apps

Use the `webapp-testing` skill's `scripts/with_server.py` to manage server lifecycle, then capture screenshots after `page.wait_for_load_state('networkidle')`.

### Key Capture Practices
- Always wait for `networkidle` + extra timeout for font loading
- For animations, wait at least 1500ms after triggering the view change
- Use 1920x1080 viewport for presentation-quality captures
- Name screenshots sequentially for easy comparison

---

## Phase 3: Visual Critique

Read each screenshot using the Read tool and critically assess against these dimensions:

### Critique Checklist (per screen)

**Typography**
- [ ] Font choices are distinctive — not generic (no Arial, Inter, Roboto)
- [ ] Type hierarchy is dramatic — clear size/weight contrast between levels
- [ ] Line height and letter spacing feel intentional, not default
- [ ] Text is readable at the intended viewing distance
- [ ] Font weights render properly (thin weights on dark backgrounds can vanish)

**Color & Atmosphere**
- [ ] Color palette is cohesive and committed — not timid or evenly distributed
- [ ] Dominant color with sharp accents (not everything the same intensity)
- [ ] Background has atmosphere and depth — not just a flat solid color
- [ ] Sufficient contrast for readability (WCAG minimums)
- [ ] Each view has a distinct visual temperature/mood (not all identical)

**Spatial Composition**
- [ ] Layout feels intentional — not default-centered-everything
- [ ] Variety across views: asymmetric, grid-based, editorial, full-bleed, etc.
- [ ] Negative space is generous and purposeful, OR density is controlled
- [ ] No two adjacent views use the same layout pattern
- [ ] Elements have breathing room — nothing feels cramped or overlapping

**Motion & Interaction** (verify in browser, not just screenshots)
- [ ] High-impact moments are well-orchestrated (page load, transitions)
- [ ] Stagger timing feels natural, not mechanical
- [ ] No gratuitous animation — every motion serves a purpose
- [ ] Hover states surprise and delight where appropriate

**Content & Visual Elements**
- [ ] Icons/graphics are appropriately sized and visible
- [ ] Cards/containers have sufficient visual distinction from each other
- [ ] Diagrams and data visualizations are legible and well-composed
- [ ] Decorative elements enhance rather than clutter

**Overall Craftsmanship**
- [ ] Does this look like it was labored over by an expert, or auto-generated?
- [ ] Is there a clear aesthetic point of view, or does it feel generic?
- [ ] What is the ONE thing someone would remember about this design?
- [ ] Would this make someone say "wow" or just "fine"?

### How to Write a Critique

For each screen, produce a structured assessment:

```
## Slide/View N — [Title]
**Overall Grade**: A/B/C/D/F
**Strongest Element**: [What works best]
**Weakest Element**: [What needs most improvement]
**Specific Issues**:
1. [Issue] — [Why it matters] — [Proposed fix]
2. [Issue] — [Why it matters] — [Proposed fix]
**Priority**: High/Medium/Low for this improvement cycle
```

---

## Phase 3b: Design Council Review (Enhanced Critique)

When the user requests a council review, or when the design needs a rigorous multi-perspective critique, assemble a **Design Council** — a panel of 4-5 specialized subagent critics who each review every screen from their unique discipline. This produces dramatically higher-quality feedback than a single-perspective review.

### Ask Before Activating

Before assembling the council, ask the user:
> "Would you like me to run a Design Council review? This launches 4-5 specialized critic agents in parallel — each an elite designer focused on a different dimension (typography, spatial composition, atmosphere, minimalism, brand narrative). They'll review every screen and deliver specific, actionable feedback that I'll synthesize into a prioritized improvement plan."

### Council Formation

Launch **4-5 agents in parallel**, each with a distinct design discipline and a strong critical persona. Each agent:

1. **Has a name, background, and design heroes** — this grounds their perspective and makes critiques consistent
2. **Focuses on ONE dimension only** — prevents overlapping/generic feedback
3. **Reviews every screen/slide** — grades each A-F, identifies the single biggest problem, provides one specific fix
4. **Delivers a TOP 5 ranked list** — the most impactful changes in their domain, with specific CSS/HTML instructions
5. **Is merciless but constructive** — the goal is to make the work extraordinary, not to tear it down for sport

### Recommended Council Composition

| Role | Focus | Persona Archetype | Key Question |
|------|-------|-------------------|--------------|
| **The Minimalist** | Reduction, negative space, what to remove | Dieter Rams, Kenya Hara, Muji | "What doesn't earn its place?" |
| **The Typographer** | Type hierarchy, sizing, spacing, readability | Massimo Vignelli, Erik Spiekermann | "Can the type alone carry the design?" |
| **The Spatial Architect** | Layout composition, eye flow, spatial variety | Zaha Hadid, Josef Müller-Brockmann | "Is the designer composing, or is CSS?" |
| **The Atmosphere Designer** | Mood, gradients, glow, emotional temperature | Jony Ive keynote era, Bradford Young | "Does each screen FEEL different?" |
| **The Brand Strategist** | Narrative coherence, story arc, audience impact | Paula Scher, Airbnb redesign | "Does every visual choice serve the story?" |

### Persona Construction Template

Each agent prompt should include:
```
You are **[Name]**, [background — 2 sentences establishing credibility].
Your design religion is [core belief]. Your heroes are [2-3 names].
You believe [strong opinion about what most designers get wrong].

You are reviewing [description of the project and its context].

**Design context:** [colors, fonts, audience, goal]

**For each slide/screen, give:**
1. A grade (A through F)
2. Your single biggest problem
3. ONE specific, actionable fix (with CSS values where applicable)

**Focus EXCLUSIVELY on [their dimension].**

After individual critiques, give your **TOP 5 CHANGES** ranked by impact.

Be merciless. [Closing line that reinforces their standards.]
```

### Critical Calibration

To ensure critics are genuinely critical (not sycophantic):
- Frame them as **elite professionals who have seen a thousand mediocre versions** of this
- Include phrases like "Be merciless," "Be devastating," "Be unforgiving," "Be ruthless"
- Tell them **their reputation is on the line** — they would never approve something mediocre
- Ask them to compare against **the best work in their field**, not against average
- Give them permission to grade harshly — "a C+ from you is still useful feedback"

### Synthesis Protocol

After all critics report:

1. **Identify consensus issues** — problems mentioned by 3+ critics (highest priority)
2. **Resolve conflicts** — where critics disagree (e.g., Minimalist says "remove" but Brand says "keep"), the chief designer decides based on project goals
3. **Tier the changes**: Tier 1 (transformative), Tier 2 (high impact), Tier 3 (polish)
4. **Create a per-screen target grade** — what each screen should achieve after improvements
5. **Save the synthesis** as a document for reference in future cycles

### When to Re-Convene

Run the council again after implementing Tier 1 and Tier 2 changes. The second review should show meaningful grade improvements. If not, the implementation missed the point of the feedback.

---

## Phase 4: Improve

### Anti-Patterns to Eliminate (from frontend-design skill)
- Generic AI aesthetics: overused fonts, cliched purple-on-white gradients
- Predictable layouts: everything centered, uniform spacing, symmetrical grids
- Cookie-cutter components: identical cards, uniform icon sizes, repetitive patterns
- Timid color usage: everything the same intensity, no dominant/accent hierarchy
- Flat backgrounds: solid colors with no atmosphere, texture, or depth

### Design Moves to Apply
- **Typography**: Dramatic size contrasts. Unexpected weight choices. Thin for cinematic heroes, bold for emphasis moments.
- **Color**: Dominant + sharp accent. One color owns the slide, others punctuate.
- **Motion**: One well-orchestrated page load with staggered reveals > scattered micro-interactions.
- **Spatial composition**: Asymmetry. Overlap. Grid-breaking elements. Diagonal flow.
- **Backgrounds**: Gradient meshes, noise textures, geometric patterns, layered transparencies, subtle grain.
- **Variety**: No two screens should use the same composition. Vary alignment, density, element types, color emphasis.

### Implementation

Make targeted CSS/HTML changes. For each change:
1. Identify the specific element and file location
2. Make the edit
3. Note what was changed and why (for the critique log)

**CRITICAL**: After making changes, resist the urge to add more. Instead, ask: "How can I make what's already here more of a piece of art?" Refinement > addition.

---

## Phase 5: Verify

Re-run the screenshot script for changed views only (or all views if changes were global like background or typography). Compare before/after:

- Did the change achieve the intended effect?
- Did it introduce any new issues (overlapping text, broken layout, invisible elements)?
- Does it still look correct at different viewport sizes if relevant?

### Common CSS Issues to Watch For
- `position: relative` on slide/view containers overriding `position: absolute` (causes stacking/offset bugs)
- Inline styles from JavaScript overriding CSS class rules (inline always wins in cascade)
- `z-index` without a positioned parent (z-index requires position: relative/absolute/fixed)
- `opacity: 0` set by animation systems that never clears (content invisible)
- `overflow: hidden` clipping content that extends beyond container bounds
- Font weights that don't exist in the loaded font (renders as nearest available weight)

---

## Phase 6: Repeat

Continue the loop until:
- Every screen grades B+ or higher in the critique
- The design has a clear, memorable aesthetic identity
- Typography, color, and composition vary meaningfully across views
- No generic/cookie-cutter patterns remain
- You can articulate what makes this design UNFORGETTABLE

Typically 2-3 full cycles are needed for a polished result. Complex interfaces may need more.

---

## Quick Reference: Debugging Visual Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Content invisible | Animation opacity stuck at 0, or positioned off-screen | Check computed opacity, transform, and getBoundingClientRect().y |
| Slide/view appears blank | `position: relative` overriding `position: absolute` on slide containers | Remove the override; absolute already establishes stacking context |
| Text too faint on dark bg | Font weight too thin (100-200) or color too close to background | Increase weight to 300+ or brighten text color |
| All views look the same | Same background, same layout pattern, same color intensity | Give each view a unique atmospheric signature |
| Animation doesn't trigger | Inline styles override CSS classes; or no state change for transition | Use class-based animation resets with `!important`; force reflow between states |
| Layout breaks on resize | Fixed pixel values instead of responsive units | Use `clamp()`, `vw/vh`, `%`, or CSS Grid/Flexbox |
