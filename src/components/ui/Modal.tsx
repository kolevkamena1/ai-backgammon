import { useEscapeKey } from '@/hooks/useEscapeKey'
import { cn } from '@/utils/cn'
import { X } from 'lucide-react'
import type { ComponentType, MouseEvent, ReactNode, SVGProps } from 'react'

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
 * Dialog chrome shared by every modal: backdrop, Escape to close, click-outside to close and a
 * titled panel. Focus is deliberately NOT managed here — a parent effect would override the
 * child `autoFocus` that the BYOK form relies on, so each host owns its own initial focus.
 */
const Modal = ({
  titleId,
  title,
  subtitle,
  icon: Icon,
  onClose,
  children,
  panelClassName,
  closeLabel = 'Close',
}: ModalProps) => {
  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  useEscapeKey(onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl',
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
