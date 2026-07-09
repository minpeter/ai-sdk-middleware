// biome-ignore-all lint: official evlog test port — keep upstream structure
// biome-ignore-all assist: official evlog test port — keep upstream structure
// biome-ignore-all format: official evlog test port — keep upstream structure

/**
 * Identical to evlog's internal mergeInto / mergeWideEventFields.
 * Re-exported for tests that mirror wide-event accumulation without importing
 * non-public package paths.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeWideEventFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key in source) {
    const sourceVal = source[key]
    if (sourceVal === undefined || sourceVal === null) continue
    const targetVal = target[key]
    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      mergeWideEventFields(targetVal, sourceVal)
    } else if (Array.isArray(targetVal) && Array.isArray(sourceVal)) {
      target[key] = [...targetVal, ...sourceVal]
    } else {
      target[key] = sourceVal
    }
  }
}
