# How to Create Architecture Diagrams

> Method used to create the memory architecture and team workflow diagrams.
> Works in Claude.ai with the Visualizer tool, then exports to SVG/PNG.

## Step 1 — Design in Claude.ai Visualizer

Ask Claude to create a diagram using the `show_widget` tool. This renders
an interactive SVG inline in the chat. Iterate by asking for changes.

Key phrases that trigger good diagrams:
- "create a structural diagram showing..."
- "show the architecture with X, Y, Z as layers..."
- "put [roles] as columns and [layers] as horizontal bands..."

The Visualizer uses CSS variables for dark/light mode and pre-built color
classes (`c-blue`, `c-teal`, `c-amber`, `c-coral`, `c-pink`, `c-purple`,
`c-gray`, `c-green`, `c-red`) that auto-adapt to both modes.

## Step 2 — Export to standalone SVG

The Visualizer SVG uses CSS variables (dark mode). For a static export
(LinkedIn, docs), you need **hardcoded colors on a white background**.

Claude creates a standalone SVG with:
- `style="background:#fff"` on the root SVG
- All `fill`, `stroke`, `font-size`, `font-weight` hardcoded (no CSS vars)
- System font stack: `-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`
- Double resolution: `width="1360" height="H"` with `viewBox="0 0 680 H/2"`

**Critical:** Write the SVG via shell heredoc, NOT via Desktop Commander
write_file (which can introduce encoding issues):

```bash
cat > /path/to/diagram.svg << 'SVGEOF'
<svg width="1360" height="880" viewBox="0 0 680 440" xmlns="http://www.w3.org/2000/svg"
     style="background:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">
  ... hardcoded SVG content ...
</svg>
SVGEOF
```

## Step 3 — Convert SVG to PNG

```bash
# Requires: brew install librsvg
rsvg-convert -w 1360 -h 880 input.svg -o output.png
```

Match `-w` and `-h` to the SVG's `width` and `height` attributes.
Output is 2x resolution — looks sharp on LinkedIn and Retina displays.

## Step 4 — Save to standard locations

```
datacore/diagrams/
  [name].svg              ← source SVG (hardcoded colors)
  [name].png              ← rendered PNG

buildinpublic/linkedin/drafts/candidates/
  [name].png              ← copy for LinkedIn posting
  [name]-post.md          ← candidate post text
```

## Color Reference (light mode, white background)

From the Visualizer's built-in palette. Use these hex values in standalone SVGs:

| Color   | Fill (50) | Stroke (600) | Title text (800) | Subtitle text (600) |
|---------|-----------|--------------|-------------------|---------------------|
| Gray    | #F1EFE8   | #5F5E5A      | #444441           | #5F5E5A             |
| Blue    | #E6F1FB   | #185FA5      | #0C447C           | #185FA5             |
| Teal    | #E1F5EE   | #0F6E56      | #085041           | #0F6E56             |
| Purple  | #EEEDFE   | #534AB7      | #3C3489           | #534AB7             |
| Coral   | #FAECE7   | #993C1D      | #712B13           | #993C1D             |
| Pink    | #FBEAF0   | #993556      | #72243E           | #993556             |
| Amber   | #FAEEDA   | #854F0B      | #633806           | #854F0B             |
| Green   | #EAF3DE   | #3B6D11      | #27500A           | #3B6D11             |
| Red     | #FCEBEB   | #A32D2D      | #791F1F           | #A32D2D             |

## SVG Text Sizing

Font: Anthropic Sans (or system sans-serif fallback)
- Title: `font-size="14" font-weight="500"` → ~8px per character
- Subtitle: `font-size="12" font-weight="400"` → ~7px per character
- Always use `text-anchor="middle" dominant-baseline="central"` for centered text
- Box width = max(title_chars * 8, subtitle_chars * 7) + 24px padding

## Tips

- Use `stroke-width="0.5"` for refined borders
- Use `stroke-dasharray="4 3"` for container outlines (dashed)
- Use `rx="6"` for small boxes, `rx="10"` for containers, `rx="14"` for large areas
- Keep ≤4 boxes per horizontal row at 680px viewBox width
- Use 2-3 color ramps max per diagram — more = visual noise
- Verify SVG encoding: `head -1 file.svg | xxd | head -1` should start with `3c73`

## Diagrams Created So Far

| Diagram | File | Purpose |
|---------|------|---------|
| Team workflow | `datacore/diagrams/team-workflow.svg` | Post #6: David → OpenClaw → Datacore → 3 AIs |
| Memory arch (implementation) | `datacore/diagrams/memory-architecture.svg` | 4 layers x 4 specific roles |
| Memory arch (general) | `datacore/diagrams/memory-architecture-general.svg` | Universal pattern for any multi-agent system |
| Data architecture (complete) | `datacore/diagrams/data-architecture-complete.svg` | Full pipeline: sources → capture → MCP → Bronze/Silver/Gold → Azure |
