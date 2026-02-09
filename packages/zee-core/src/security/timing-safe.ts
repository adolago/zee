/**
 * Timing-Safe Comparison Utilities
 *
 * Prevents timing attacks in security-sensitive comparisons.
 * Based on Zee commit 3b8792ee29 (timing attack fix).
 *
 * The risk: String comparison using === can leak information through timing differences.
 * An attacker can measure response times to deduce the correct value character by character.
 *
 * The fix: Use constant-time comparison that takes the same amount of time
 * regardless of where the strings differ.
 *
 * @module security/timing-safe
 */

import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto"

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Uses Node.js crypto.timingSafeEqual under the hood.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8")
  const bufB = Buffer.from(b, "utf-8")

  // If byte lengths differ, comparison is not meaningful
  // but we still need to prevent timing leaks
  if (bufA.length !== bufB.length) {
    // Compare against dummy of same length to maintain constant time
    const dummy = Buffer.alloc(bufA.length)
    cryptoTimingSafeEqual(bufA, dummy)
    return false
  }

  return cryptoTimingSafeEqual(bufA, bufB)
}

/**
 * Compare two buffers in constant time.
 * Thin wrapper around Node.js crypto.timingSafeEqual.
 *
 * @param a - First buffer
 * @param b - Second buffer
 * @returns true if buffers are equal
 */
export function timingSafeEqualBuffer(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // Compare against dummy to maintain constant time
    const dummy = Buffer.alloc(a.length)
    cryptoTimingSafeEqual(a, dummy)
    return false
  }
  return cryptoTimingSafeEqual(a, b)
}

/**
 * Compare two hex strings in constant time.
 * Useful for comparing hashes, tokens, or signatures.
 *
 * @param a - First hex string
 * @param b - Second hex string
 * @returns true if hex strings are equal
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  // Normalize to lowercase for comparison
  const normalA = a.toLowerCase()
  const normalB = b.toLowerCase()
  return timingSafeEqual(normalA, normalB)
}

/**
 * Verify a signature or hash in constant time.
 * This is a common pattern for webhook signature verification.
 *
 * @param expected - Expected signature/hash
 * @param actual - Actual signature/hash from request
 * @returns true if signatures match
 */
export function verifySignature(expected: string, actual: string): boolean {
  // Handle different formats (with or without prefix)
  const normalExpected = expected.replace(/^sha256=/, "")
  const normalActual = actual.replace(/^sha256=/, "")
  return timingSafeEqualHex(normalExpected, normalActual)
}

/**
 * Create a signature verifier for a specific algorithm.
 * Returns a function that verifies signatures in constant time.
 *
 * @param algorithm - Hash algorithm (e.g., "sha256", "sha1")
 * @returns Verifier function
 */
export function createSignatureVerifier(algorithm: string) {
  const prefix = `${algorithm}=`
  return (expected: string, actual: string): boolean => {
    const normalExpected = expected.startsWith(prefix) ? expected.slice(prefix.length) : expected
    const normalActual = actual.startsWith(prefix) ? actual.slice(prefix.length) : actual
    return timingSafeEqualHex(normalExpected, normalActual)
  }
}

// Pre-configured verifiers for common algorithms
export const verifySha256Signature = createSignatureVerifier("sha256")
export const verifySha1Signature = createSignatureVerifier("sha1")
