import { useEffect } from 'react'

/**
 * Calls `handler` when Escape is pressed. Pass `enabled: false` to keep the hook mounted
 * but inert — the hook order stays stable either way.
 */
export function useEscapeKey(handler: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        handler()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handler, enabled])
}
