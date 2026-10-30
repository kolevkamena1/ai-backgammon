/** Class-name fragments, nested arrays and falsy values are all accepted. */
export type ClassValue = string | number | false | null | undefined | ClassValue[]

/**
 * Dependency-free className joiner (the job `clsx` usually does).
 * Falsy values are dropped so `cn('a', cond && 'b')` reads naturally.
 */
export function cn(...values: ClassValue[]): string {
  const collected: string[] = []

  const walk = (value: ClassValue): void => {
    if (!value && value !== 0) {
      return
    }
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    collected.push(String(value))
  }

  values.forEach(walk)
  return collected.join(' ')
}
