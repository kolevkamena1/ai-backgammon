import type { DoublingCubeState } from '@/types/gameMatch'
import { cn } from '@/utils/cn'
import type { FC } from 'react'

interface DoublingCubeProps {
  cube: DoublingCubeState
  className?: string
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  interactive?: boolean
  title?: string
}

export const DoublingCube: FC<DoublingCubeProps> = ({
  cube,
  className = '',
  size = 'md',
  onClick,
  interactive = false,
  title,
}) => {
  const displayValue = cube.value === 1 ? '64' : String(cube.value)

  const sizeClasses = {
    sm: 'size-7 text-xs',
    md: 'size-9 text-sm font-bold',
    lg: 'size-11 text-base font-extrabold',
  }[size]

  const label = `Doubling cube showing ${displayValue} (current stake multiplier ${cube.value})`
  const resolvedTitle =
    title ??
    `Doubling cube: ${cube.value}x stake (Owned by: ${cube.owner === 'centered' ? 'Centered / Neutral' : cube.owner})`
  const sharedClassName = cn(
    'relative grid place-items-center select-none rounded-lg border-2 shadow-md transition-all',
    'border-amber-500/80 bg-gradient-to-br from-amber-100 via-amber-200 to-amber-300 text-slate-900',
    'dark:border-amber-400/90 dark:from-amber-200 dark:via-amber-300 dark:to-amber-400',
    interactive &&
      'cursor-pointer hover:scale-105 active:scale-95 hover:shadow-lg hover:ring-2 hover:ring-amber-400/60',
    sizeClasses,
    className,
  )
  const content = (
    <>
      <span className="font-mono tracking-tighter drop-shadow-xs">{displayValue}</span>
      {cube.owner !== 'centered' && (
        <span
          className={cn(
            'absolute -bottom-1 -right-1 size-2.5 rounded-full border border-black/40',
            cube.owner === 'light' ? 'bg-amber-100' : 'bg-slate-900',
          )}
          title={`Owned by ${cube.owner === 'light' ? 'White' : 'Black'}`}
        />
      )}
    </>
  )

  if (interactive) {
    return (
      <button
        type="button"
        aria-label={label}
        title={resolvedTitle}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick?.()
          }
        }}
        className={sharedClassName}
      >
        {content}
      </button>
    )
  }

  return (
    <div role="img" aria-label={label} title={resolvedTitle} className={sharedClassName}>
      {content}
    </div>
  )
}

export default DoublingCube

