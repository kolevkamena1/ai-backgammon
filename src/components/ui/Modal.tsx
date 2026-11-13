import { useEscapeKey } from '@/hooks/useEscapeKey'
import { cn } from '@/utils/cn'
import { X } from 'lucide-react'
import { useEffect, useRef, type ComponentType, type MouseEvent, type ReactNode, type SVGProps } from 'react'

const FOCUSABLE_SELECTOR =
  // `summary` is natively focusable (the visible handle of a <details>) and must be a trap
  // boundary too, or Tab from it walks straight out of the dialog (R5).
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/**
 * Whether a focusable candidate is actually rendered. Controls inside a collapsed `<details>`
 * still match the selector but cannot receive focus, so a trap that counts them stalls at the
 * boundary (R5). Structural rather than layout-based, so it behaves the same in jsdom tests.
 */
function isRenderedFocusable(el: HTMLElement): boolean {
  if (el.hidden) {
    return false
  }
  const closed = el.closest<HTMLDetailsElement>('details:not([open])')
  if (closed !== null) {
    // The summary itself stays visible while its <details> is collapsed.
    const summary = closed.querySelector('summary')
    if (summary === null || !summary.contains(el)) {
      return false
    }
  }
  return true
}

interface ModalProps {
  /** Stable id for the heading, wired to aria-labelledby. */
  titleId: string
  title: string
  subtitle?: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  onClose: () => void
  children: ReactNode
  /** Widens the panel; the default suits short forms. */
  panelClassName?: string
  closeLabel?: string
}

/**
 * Dialog chrome shared by every modal: backdrop, Escape to close, click-outside to close, a
 * titled panel, keyboard focus trap (Tab / Shift+Tab), and focus restoration on unmount. If a child
 * already claimed focus via `autoFocus` (such as the BYOK form), initial focus stays on that child.
 */
const Modal = ({
  titleId,
  title,
  subtitle,
  icon: Icon,
  onClose,
  children,
  panelClassName = 'max-w-md',
  closeLabel = 'Close',
}: ModalProps) => {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  useEscapeKey(onClose)

  useEffect(() => {
    const panel = panelRef.current
    const previousFocus = previousFocusRef.current ?? null

    if (panel && !panel.contains(document.activeElement)) {
      const firstFocusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find(
        isRenderedFocusable,
      )
      ;(firstFocusable ?? panel).focus()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        isRenderedFocusable,
      )
      if (focusables.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (active === first || !panelRef.current.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !panelRef.current.contains(active)) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
        previousFocus.focus()
      }
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl',
          panelClassName,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-300">
              <Icon className="size-4" aria-hidden />
            </span>
            <div>
              <h2 id={titleId} className="text-base font-semibold text-slate-50">
                {title}
              </h2>
              {subtitle ? <p className="text-xs text-slate-400">{subtitle}</p> : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {children}
      </div>
    </div>
  )
}

export default Modal
