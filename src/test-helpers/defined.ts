// biome-ignore-all lint: official evlog test port — keep upstream structure
// biome-ignore-all assist: official evlog test port — keep upstream structure
// biome-ignore-all format: official evlog test port — keep upstream structure

import { expect } from 'vitest'

/**
 * Vitest assertion + type narrowing — replaces `value!` after
 * `expect(value).toBeDefined()`.
 */
export function defined<T>(value: T | null | undefined, label?: string): T {
  expect(value, label).toBeDefined()
  if (value === null || value === undefined) throw new Error(label ?? 'expected defined value')
  return value
}

