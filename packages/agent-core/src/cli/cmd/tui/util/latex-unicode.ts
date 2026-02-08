/**
 * LaTeX to Unicode text conversion for inline math.
 *
 * Converts common LaTeX symbols to their Unicode equivalents for
 * text-mode rendering. Handles Greek letters, operators, sub/superscripts,
 * and common math symbols.
 *
 * This is a best-effort conversion -- complex expressions may not fully
 * convert but will be cleaned up to be readable.
 */

export namespace LatexUnicode {
  // Greek letters
  const GREEK: Record<string, string> = {
    "\\alpha": "\u03B1",
    "\\beta": "\u03B2",
    "\\gamma": "\u03B3",
    "\\delta": "\u03B4",
    "\\epsilon": "\u03B5",
    "\\varepsilon": "\u03B5",
    "\\zeta": "\u03B6",
    "\\eta": "\u03B7",
    "\\theta": "\u03B8",
    "\\vartheta": "\u03D1",
    "\\iota": "\u03B9",
    "\\kappa": "\u03BA",
    "\\lambda": "\u03BB",
    "\\mu": "\u03BC",
    "\\nu": "\u03BD",
    "\\xi": "\u03BE",
    "\\pi": "\u03C0",
    "\\varpi": "\u03D6",
    "\\rho": "\u03C1",
    "\\varrho": "\u03F1",
    "\\sigma": "\u03C3",
    "\\varsigma": "\u03C2",
    "\\tau": "\u03C4",
    "\\upsilon": "\u03C5",
    "\\phi": "\u03C6",
    "\\varphi": "\u03D5",
    "\\chi": "\u03C7",
    "\\psi": "\u03C8",
    "\\omega": "\u03C9",
    "\\Gamma": "\u0393",
    "\\Delta": "\u0394",
    "\\Theta": "\u0398",
    "\\Lambda": "\u039B",
    "\\Xi": "\u039E",
    "\\Pi": "\u03A0",
    "\\Sigma": "\u03A3",
    "\\Upsilon": "\u03A5",
    "\\Phi": "\u03A6",
    "\\Psi": "\u03A8",
    "\\Omega": "\u03A9",
  }

  // Operators and relations
  const OPERATORS: Record<string, string> = {
    "\\pm": "\u00B1",
    "\\mp": "\u2213",
    "\\times": "\u00D7",
    "\\div": "\u00F7",
    "\\cdot": "\u00B7",
    "\\ast": "\u2217",
    "\\star": "\u22C6",
    "\\circ": "\u2218",
    "\\bullet": "\u2022",
    "\\oplus": "\u2295",
    "\\otimes": "\u2297",
    "\\leq": "\u2264",
    "\\le": "\u2264",
    "\\geq": "\u2265",
    "\\ge": "\u2265",
    "\\neq": "\u2260",
    "\\ne": "\u2260",
    "\\approx": "\u2248",
    "\\equiv": "\u2261",
    "\\sim": "\u223C",
    "\\simeq": "\u2243",
    "\\cong": "\u2245",
    "\\propto": "\u221D",
    "\\ll": "\u226A",
    "\\gg": "\u226B",
    "\\subset": "\u2282",
    "\\supset": "\u2283",
    "\\subseteq": "\u2286",
    "\\supseteq": "\u2287",
    "\\in": "\u2208",
    "\\notin": "\u2209",
    "\\ni": "\u220B",
    "\\cup": "\u222A",
    "\\cap": "\u2229",
    "\\setminus": "\u2216",
    "\\emptyset": "\u2205",
    "\\varnothing": "\u2205",
    "\\land": "\u2227",
    "\\lor": "\u2228",
    "\\neg": "\u00AC",
    "\\lnot": "\u00AC",
    "\\forall": "\u2200",
    "\\exists": "\u2203",
    "\\nexists": "\u2204",
    "\\partial": "\u2202",
    "\\nabla": "\u2207",
    "\\infty": "\u221E",
    "\\aleph": "\u2135",
    "\\hbar": "\u210F",
    "\\ell": "\u2113",
    "\\wp": "\u2118",
    "\\Re": "\u211C",
    "\\Im": "\u2111",
    "\\to": "\u2192",
    "\\rightarrow": "\u2192",
    "\\leftarrow": "\u2190",
    "\\leftrightarrow": "\u2194",
    "\\Rightarrow": "\u21D2",
    "\\Leftarrow": "\u21D0",
    "\\Leftrightarrow": "\u21D4",
    "\\mapsto": "\u21A6",
    "\\uparrow": "\u2191",
    "\\downarrow": "\u2193",
    "\\ldots": "\u2026",
    "\\cdots": "\u22EF",
    "\\vdots": "\u22EE",
    "\\ddots": "\u22F1",
    "\\dots": "\u2026",
    "\\langle": "\u27E8",
    "\\rangle": "\u27E9",
    "\\lceil": "\u2308",
    "\\rceil": "\u2309",
    "\\lfloor": "\u230A",
    "\\rfloor": "\u230B",
    "\\perp": "\u22A5",
    "\\parallel": "\u2225",
    "\\angle": "\u2220",
    "\\triangle": "\u25B3",
    "\\square": "\u25A1",
    "\\diamond": "\u25C7",
    "\\checkmark": "\u2713",
    "\\dagger": "\u2020",
    "\\ddagger": "\u2021",
  }

  // Big operators (rendered as single Unicode chars for inline)
  const BIG_OPERATORS: Record<string, string> = {
    "\\sum": "\u2211",
    "\\prod": "\u220F",
    "\\coprod": "\u2210",
    "\\int": "\u222B",
    "\\iint": "\u222C",
    "\\iiint": "\u222D",
    "\\oint": "\u222E",
    "\\bigcup": "\u22C3",
    "\\bigcap": "\u22C2",
    "\\bigoplus": "\u2A01",
    "\\bigotimes": "\u2A02",
    "\\bigvee": "\u22C1",
    "\\bigwedge": "\u22C0",
  }

  // Superscript Unicode digits/letters
  const SUPERSCRIPTS: Record<string, string> = {
    "0": "\u2070",
    "1": "\u00B9",
    "2": "\u00B2",
    "3": "\u00B3",
    "4": "\u2074",
    "5": "\u2075",
    "6": "\u2076",
    "7": "\u2077",
    "8": "\u2078",
    "9": "\u2079",
    "+": "\u207A",
    "-": "\u207B",
    "=": "\u207C",
    "(": "\u207D",
    ")": "\u207E",
    n: "\u207F",
    i: "\u2071",
    a: "\u1D43",
    b: "\u1D47",
    c: "\u1D9C",
    d: "\u1D48",
    e: "\u1D49",
    f: "\u1DA0",
    g: "\u1D4D",
    h: "\u02B0",
    j: "\u02B2",
    k: "\u1D4F",
    l: "\u02E1",
    m: "\u1D50",
    o: "\u1D52",
    p: "\u1D56",
    r: "\u02B3",
    s: "\u02E2",
    t: "\u1D57",
    u: "\u1D58",
    v: "\u1D5B",
    w: "\u02B7",
    x: "\u02E3",
    y: "\u02B8",
    z: "\u1DBB",
    T: "\u1D40",
  }

  // Subscript Unicode digits/letters
  const SUBSCRIPTS: Record<string, string> = {
    "0": "\u2080",
    "1": "\u2081",
    "2": "\u2082",
    "3": "\u2083",
    "4": "\u2084",
    "5": "\u2085",
    "6": "\u2086",
    "7": "\u2087",
    "8": "\u2088",
    "9": "\u2089",
    "+": "\u208A",
    "-": "\u208B",
    "=": "\u208C",
    "(": "\u208D",
    ")": "\u208E",
    a: "\u2090",
    e: "\u2091",
    h: "\u2095",
    i: "\u1D62",
    j: "\u2C7C",
    k: "\u2096",
    l: "\u2097",
    m: "\u2098",
    n: "\u2099",
    o: "\u2092",
    p: "\u209A",
    r: "\u1D63",
    s: "\u209B",
    t: "\u209C",
    u: "\u1D64",
    v: "\u1D65",
    x: "\u2093",
  }

  // Function names that should be rendered upright
  const FUNCTIONS = new Set([
    "sin",
    "cos",
    "tan",
    "sec",
    "csc",
    "cot",
    "arcsin",
    "arccos",
    "arctan",
    "sinh",
    "cosh",
    "tanh",
    "log",
    "ln",
    "exp",
    "lim",
    "sup",
    "inf",
    "max",
    "min",
    "det",
    "dim",
    "ker",
    "gcd",
    "deg",
    "hom",
    "arg",
    "mod",
  ])

  function toSuperscript(s: string): string {
    return [...s].map((c) => SUPERSCRIPTS[c] ?? c).join("")
  }

  function toSubscript(s: string): string {
    return [...s].map((c) => SUBSCRIPTS[c] ?? c).join("")
  }

  /**
   * Strip braces: {content} -> content
   */
  function stripBraces(s: string): string {
    s = s.trim()
    if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1)
    return s
  }

  /**
   * Convert a LaTeX inline expression to Unicode text.
   * Best-effort: complex expressions may be partially converted.
   */
  export function convert(tex: string): string {
    let result = tex.trim()

    // Replace known symbols first (longest match first)
    const allSymbols = { ...GREEK, ...OPERATORS, ...BIG_OPERATORS }
    const sortedKeys = Object.keys(allSymbols).sort((a, b) => b.length - a.length)
    for (const key of sortedKeys) {
      // Use word boundary after backslash commands to avoid partial matches
      const escaped = key.replace(/\\/g, "\\\\")
      const re = new RegExp(escaped + "(?![a-zA-Z])", "g")
      result = result.replace(re, allSymbols[key])
    }

    // \text{...} and \mathrm{...} -- render content as-is
    result = result.replace(/\\(?:text|mathrm|textrm)\{([^}]*)\}/g, "$1")

    // \mathbb{X} -- double-struck letters (common: R, N, Z, Q, C)
    const DOUBLE_STRUCK: Record<string, string> = {
      A: "\uD835\uDD38",
      B: "\uD835\uDD39",
      C: "\u2102",
      D: "\uD835\uDD3B",
      E: "\uD835\uDD3C",
      F: "\uD835\uDD3D",
      G: "\uD835\uDD3E",
      H: "\u210D",
      I: "\uD835\uDD40",
      J: "\uD835\uDD41",
      K: "\uD835\uDD42",
      L: "\uD835\uDD43",
      M: "\uD835\uDD44",
      N: "\u2115",
      O: "\uD835\uDD46",
      P: "\u2119",
      Q: "\u211A",
      R: "\u211D",
      S: "\uD835\uDD4A",
      T: "\uD835\uDD4B",
      U: "\uD835\uDD4C",
      V: "\uD835\uDD4D",
      W: "\uD835\uDD4E",
      X: "\uD835\uDD4F",
      Y: "\uD835\uDD50",
      Z: "\u2124",
    }
    result = result.replace(/\\mathbb\{([A-Z])\}/g, (_, c) => DOUBLE_STRUCK[c] ?? c)

    // \sqrt{x} -> root symbol
    result = result.replace(/\\sqrt(?:\[([^\]]*)\])?\{([^}]*)\}/g, (_, n, content) => {
      if (n) return toSuperscript(n) + "\u221A(" + content + ")"
      return "\u221A(" + content + ")"
    })
    result = result.replace(/\\sqrt\s+(\w)/g, (_, c) => "\u221A" + c)

    // \frac{a}{b} -> a/b
    result = result.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, (_, num, den) => {
      const n = stripBraces(num)
      const d = stripBraces(den)
      // Simple single-char fractions
      if (n.length <= 2 && d.length <= 2) return n + "/" + d
      return "(" + n + ")/(" + d + ")"
    })

    // \binom{n}{k} -> (n choose k) using parentheses
    result = result.replace(/\\binom\{([^}]*)\}\{([^}]*)\}/g, (_, n, k) => {
      return "C(" + stripBraces(n) + "," + stripBraces(k) + ")"
    })

    // Function names: \sin, \cos, etc.
    for (const fn of FUNCTIONS) {
      const re = new RegExp("\\\\" + fn + "(?![a-zA-Z])", "g")
      result = result.replace(re, fn)
    }

    // Superscripts: ^{content} or ^x
    result = result.replace(/\^\{([^}]*)\}/g, (_, content) => toSuperscript(content))
    result = result.replace(/\^([a-zA-Z0-9+\-])/g, (_, c) => toSuperscript(c))

    // Subscripts: _{content} or _x
    result = result.replace(/_\{([^}]*)\}/g, (_, content) => toSubscript(content))
    result = result.replace(/_([a-zA-Z0-9])/g, (_, c) => toSubscript(c))

    // \overline{x} -> x with combining overline
    result = result.replace(/\\overline\{([^}]*)\}/g, (_, c) => c + "\u0305")
    result = result.replace(/\\bar\{([^}]*)\}/g, (_, c) => c + "\u0304")

    // \hat, \tilde, \vec
    result = result.replace(/\\hat\{([^}]*)\}/g, (_, c) => c + "\u0302")
    result = result.replace(/\\tilde\{([^}]*)\}/g, (_, c) => c + "\u0303")
    result = result.replace(/\\vec\{([^}]*)\}/g, (_, c) => c + "\u20D7")
    result = result.replace(/\\dot\{([^}]*)\}/g, (_, c) => c + "\u0307")
    result = result.replace(/\\ddot\{([^}]*)\}/g, (_, c) => c + "\u0308")

    // Clean up remaining LaTeX artifacts
    result = result.replace(/\\(?:left|right|big|Big|bigg|Bigg)\s*/g, "")
    result = result.replace(/\\,|\\;|\\:|\\!/g, " ")
    result = result.replace(/\\quad/g, "  ")
    result = result.replace(/\\qquad/g, "    ")
    result = result.replace(/\\\\/g, "\n")
    result = result.replace(/\\&/g, "&")

    // Remove remaining braces that are just grouping
    result = result.replace(/\{([^{}]*)\}/g, "$1")
    // Second pass for nested
    result = result.replace(/\{([^{}]*)\}/g, "$1")

    // Remove any remaining backslash commands we don't handle
    result = result.replace(/\\[a-zA-Z]+/g, "")

    // Collapse whitespace
    result = result.replace(/ +/g, " ").trim()

    return result
  }
}
