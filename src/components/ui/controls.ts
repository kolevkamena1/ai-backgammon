/**
 * Shared control styling, so every form in the app is visually identical and a tweak lands in
 * one place. Class strings only — no components — to keep react-refresh happy.
 */
export const FIELD =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30'

export const BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50'

export const LABEL = 'mb-1.5 block text-xs font-medium text-slate-300'

export const HINT = 'mt-1.5 text-xs text-slate-500'

/** Selectable card driven by a visually-hidden radio (see GameSetupModal). */
export const CARD =
  'flex w-full cursor-pointer flex-col gap-1 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-left transition hover:border-slate-600 has-[:checked]:border-sky-500 has-[:checked]:bg-sky-500/10'
