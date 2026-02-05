import { describe, test, expect } from "bun:test"
import {
  timingSafeEqual,
  timingSafeEqualBuffer,
  timingSafeEqualHex,
  verifySignature,
  verifySha256Signature,
} from "../../src/security/timing-safe.js"

describe("timingSafeEqual", () => {
  test("returns true for equal strings", () => {
    expect(timingSafeEqual("secret", "secret")).toBe(true)
    expect(timingSafeEqual("", "")).toBe(true)
    expect(timingSafeEqual("a".repeat(100), "a".repeat(100))).toBe(true)
  })

  test("returns false for different strings", () => {
    expect(timingSafeEqual("secret", "Secret")).toBe(false)
    expect(timingSafeEqual("secret", "secre")).toBe(false)
    expect(timingSafeEqual("secret", "secretx")).toBe(false)
    expect(timingSafeEqual("secret", "")).toBe(false)
  })

  test("handles unicode", () => {
    expect(timingSafeEqual("héllo", "héllo")).toBe(true)
    // Note: 'héllo' and 'hello' have different byte lengths due to UTF-8 encoding
    // so this comparison returns false (different lengths = false)
    expect(timingSafeEqual("héllo", "hello")).toBe(false)
    // Same length unicode strings with different content
    expect(timingSafeEqual("héllo", "hélLo")).toBe(false)
  })

  test("handles different length strings", () => {
    expect(timingSafeEqual("short", "longer")).toBe(false)
    expect(timingSafeEqual("longer", "short")).toBe(false)
  })
})

describe("timingSafeEqualBuffer", () => {
  test("returns true for equal buffers", () => {
    const a = Buffer.from("secret")
    const b = Buffer.from("secret")
    expect(timingSafeEqualBuffer(a, b)).toBe(true)
  })

  test("returns false for different buffers", () => {
    const a = Buffer.from("secret")
    const b = Buffer.from("Secret")
    expect(timingSafeEqualBuffer(a, b)).toBe(false)
  })

  test("handles different length buffers", () => {
    const a = Buffer.from("short")
    const b = Buffer.from("longer")
    expect(timingSafeEqualBuffer(a, b)).toBe(false)
  })
})

describe("timingSafeEqualHex", () => {
  test("compares hex strings case-insensitively", () => {
    expect(timingSafeEqualHex("abc123", "ABC123")).toBe(true)
    expect(timingSafeEqualHex("ABC123", "abc123")).toBe(true)
  })

  test("returns false for different hex strings", () => {
    expect(timingSafeEqualHex("abc123", "abc124")).toBe(false)
  })
})

describe("verifySignature", () => {
  test("verifies matching signatures", () => {
    const expected = "sha256=abcdef123456"
    const actual = "sha256=abcdef123456"
    expect(verifySignature(expected, actual)).toBe(true)
  })

  test("verifies signatures without prefix", () => {
    expect(verifySignature("abcdef123456", "abcdef123456")).toBe(true)
  })

  test("handles mixed prefix/no-prefix", () => {
    expect(verifySignature("sha256=abcdef", "abcdef")).toBe(true)
    expect(verifySignature("abcdef", "sha256=abcdef")).toBe(true)
  })

  test("returns false for wrong signatures", () => {
    expect(verifySignature("sha256=correct", "sha256=wrong")).toBe(false)
  })

  test("is case-insensitive for hex values", () => {
    expect(verifySignature("sha256=ABCDEF", "sha256=abcdef")).toBe(true)
  })
})

describe("verifySha256Signature", () => {
  test("verifies sha256 signatures", () => {
    const hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    expect(verifySha256Signature(`sha256=${hash}`, hash)).toBe(true)
  })
})

describe("timing attack resistance", () => {
  // This test verifies that the comparison takes similar time
  // regardless of where the strings differ
  test("comparison time is relatively constant", () => {
    const secret = "a".repeat(1000)
    const correctGuess = "a".repeat(1000)
    const wrongFirstChar = "b" + "a".repeat(999)
    const wrongLastChar = "a".repeat(999) + "b"

    // Measure multiple iterations to reduce noise
    const iterations = 1000

    const measureTime = (a: string, b: string) => {
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        timingSafeEqual(a, b)
      }
      return performance.now() - start
    }

    const correctTime = measureTime(secret, correctGuess)
    const wrongFirstTime = measureTime(secret, wrongFirstChar)
    const wrongLastTime = measureTime(secret, wrongLastChar)

    // All times should be within 5x of each other.
    // (loose bound to avoid flakiness on noisy CI / turbo-boosted CPUs)
    const maxTime = Math.max(correctTime, wrongFirstTime, wrongLastTime)
    const minTime = Math.min(correctTime, wrongFirstTime, wrongLastTime)
    expect(maxTime / minTime).toBeLessThan(5)
  })
})
