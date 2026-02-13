---
name: latex-rendering
description: Render LaTeX math expressions in the TUI with Kitty graphics and Unicode fallback
version: 1.0.0
author: Artur
tags: [math, latex, rendering, tui, zee]
triggers:
  - latex
  - math formula
  - equation
  - render math
  - math display
---

# LaTeX Rendering

Render LaTeX math expressions inline and as block formulas directly in the terminal.

## How It Works

The TUI detects LaTeX math in assistant responses and renders it using a two-tier pipeline:

### Inline Math (`$...$`)

Single-dollar expressions are converted to Unicode text:

| LaTeX | Rendered |
|-------|----------|
| `$\alpha + \beta$` | a + b |
| `$x^2 + y^2 = r^2$` | x + y = r |
| `$\sum_{i=1}^n x_i$` | (sum) x_i |
| `$\mathbb{R}$` | R (double-struck) |
| `$\frac{a}{b}$` | a/b |
| `$\sqrt{x}$` | root(x) |

Supports Greek letters, operators, relations, sub/superscripts, set notation, arrows, accents (`\hat`, `\vec`, `\bar`), and `\mathbb` double-struck letters.

### Block Math (`$$...$$`)

Double-dollar expressions get pixel-perfect rendering on supported terminals:

1. **Kitty graphics** (WezTerm, Kitty, Ghostty) -- MathJax SVG rasterized to PNG via Skia, displayed as inline image
2. **Unicode fallback** (all other terminals) -- same Unicode conversion as inline math

### Rendering Pipeline (Block)

```
TeX string
  -> mathjax tex2svg()           # TeX to self-contained SVG (pure paths)
  -> @napi-rs/canvas Image(svg)  # Skia rasterizes SVG to pixels
  -> canvas.toBuffer('image/png')
  -> base64 encode
  -> Kitty escape sequences      # \033_Ga=T,f=100,...;data\033\\
  -> process.stdout.write()
```

Results are cached (LRU, 100 entries) keyed by `tex + width + colors`.

## Architecture

### Source Files

| File | Purpose |
|------|---------|
| `tui/util/latex.ts` | Detection and extraction (`hasMath`, `splitAtBlockMath`, `replaceInlineMath`) |
| `tui/util/latex-unicode.ts` | LaTeX to Unicode text conversion |
| `tui/util/latex-render.ts` | MathJax SVG to PNG pipeline with caching |
| `tui/util/kitty-graphics.ts` | Kitty graphics protocol encoder and terminal detection |
| `tui/component/math-block.tsx` | SolidJS component for block math display |
| `tui/component/math-overlay.ts` | Shared store for image placements |

### Integration Point

`TextPart` in `routes/session/index.tsx` pre-processes content:

1. `Latex.splitAtBlockMath(text)` splits into `Array<{type: 'text'|'math', content}>`
2. Text segments: `Latex.replaceInlineMath(text, LatexUnicode.convert)` then `<code filetype="markdown">`
3. Math segments: `<MathBlock tex={content} />`

### Streaming Safety

- Incomplete `$$` blocks (no closing delimiter) are left as raw text
- Block render is debounced 100ms during streaming
- Math inside code blocks/spans is never processed

## Terminal Support

| Terminal | Inline Math | Block Math |
|----------|------------|------------|
| WezTerm | Unicode | Kitty graphics (PNG) |
| Kitty | Unicode | Kitty graphics (PNG) |
| Ghostty | Unicode | Kitty graphics (PNG) |
| Others | Unicode | Unicode fallback |

Detection uses `TERM_PROGRAM` environment variable.

## Dependencies

- `mathjax` v3.2.2 -- TeX to SVG conversion (lazy-loaded on first block math)
- `@napi-rs/canvas` v0.1.88 -- Skia-based SVG rasterization (already bundled)

## Usage for Learning

When studying math-heavy topics, ask the assistant to write formulas in LaTeX. Examples:

- "Write the quadratic formula in LaTeX"
- "Show me the Taylor series expansion"
- "Derive the Euler-Lagrange equation"
- "Explain the Fourier transform with LaTeX notation"

The formulas will render as readable Unicode inline or as pixel-perfect images in block display.
