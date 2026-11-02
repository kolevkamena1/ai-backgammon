import type {
  CountRow,
  GameRow,
  ListResponse,
  SessionRow,
  StatsSummary,
} from '@/types/stats'
import { cn } from '@/utils/cn'
import { Download, RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

type Tab = 'games' | 'sessions'

interface Query {
  days: number
  country: string
  mode: string
  outcome: string
  bots: boolean
}

const SELECT = 'rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100'
const CARD = 'rounded-xl border border-slate-800 bg-slate-900/70 p-4'

function toParams(query: Query, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ days: String(query.days), ...extra })
  if (query.country !== '') params.set('country', query.country)
  if (query.mode !== '') params.set('mode', query.mode)
  if (query.outcome !== '') params.set('outcome', query.outcome)
  if (query.bots) params.set('bots', '1')
  return params.toString()
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (response.status === 403 || response.status === 401) {
    const data = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null
    const details = data?.reason ? ` [${data.reason}]` : ''
    throw new Error(`Forbidden${details} — check Cloudflare Access configuration.`)
  }
  if (response.status === 503) throw new Error('The D1 database is not bound yet (see README → Admin stats).')
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return (await response.json()) as T
}

function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const percent = (value: number | null): string => (value === null ? '—' : `${Math.round(value * 100)}%`)

const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <div className={CARD}>
    <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-1 text-2xl font-semibold text-slate-50">{value}</div>
    {hint !== undefined ? <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div> : null}
  </div>
)

const BarList = ({ title, rows }: { title: string; rows: CountRow[] }) => {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className={CARD}>
      <h3 className="mb-2 text-sm font-semibold text-slate-100">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-slate-500">No data yet.</p> : null}
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.key} className="text-xs">
            <div className="flex justify-between gap-2 text-slate-300">
              <span className="truncate" title={row.key}>{row.key}</span>
              <span className="tabular-nums text-slate-400">{row.count}</span>
            </div>
            <div className="mt-0.5 h-1.5 rounded bg-slate-800">
              <div className="h-1.5 rounded bg-sky-500" style={{ width: `${(row.count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const DayChart = ({ rows }: { rows: StatsSummary['byDay'] }) => {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.sessions, r.games)))
  return (
    <div className={cn(CARD, 'lg:col-span-2')}>
      <h3 className="mb-2 flex items-center gap-3 text-sm font-semibold text-slate-100">
        By day
        <span className="flex items-center gap-1 text-[11px] font-normal text-slate-400">
          <i className="inline-block size-2 rounded-sm bg-sky-500" /> sessions
          <i className="ml-2 inline-block size-2 rounded-sm bg-amber-400" /> games
        </span>
      </h3>
      {rows.length === 0 ? <p className="text-xs text-slate-500">No data yet.</p> : null}
      <div className="flex h-32 items-end gap-1">
        {rows.map((row) => (
          <div key={row.day} className="flex h-full min-w-0 flex-1 items-end gap-px" title={`${row.day}: ${row.sessions} sessions, ${row.games} games`}>
            <div className="w-1/2 rounded-t bg-sky-500" style={{ height: `${(row.sessions / max) * 100}%` }} />
            <div className="w-1/2 rounded-t bg-amber-400" style={{ height: `${(row.games / max) * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}

const Th = ({ children }: { children: ReactNode }) => (
  <th className="whitespace-nowrap px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</th>
)
const Td = ({ children, title }: { children: ReactNode; title?: string }) => (
  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-200" title={title}>{children}</td>
)

const when = (iso: string): string => iso.replace('T', ' ').slice(0, 16)

const OUTCOME_STYLE: Record<string, string> = {
  finished: 'text-emerald-400',
  abandoned: 'text-amber-400',
  in_progress: 'text-slate-400',
}

interface Loaded {
  key: string
  summary: StatsSummary | null
  games: GameRow[]
  sessions: SessionRow[]
  error: string | null
}

export default function StatsPage() {
  const [query, setQuery] = useState<Query>({ days: 30, country: '', mode: '', outcome: '', bots: false })
  const [tab, setTab] = useState<Tab>('games')
  const [refreshCount, setRefreshCount] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  // `loading` is derived (the stored result belongs to an older request), so no state is set
  // synchronously inside the effect - only after the fetch settles.
  const requestKey = `${toParams(query)}#${refreshCount}`
  const loading = loaded?.key !== requestKey
  const summary = loaded?.summary ?? null
  const games = loaded?.games ?? []
  const sessions = loaded?.sessions ?? []
  const error = loaded?.error ?? null

  useEffect(() => {
    document.title = 'Stats · AI Backgammon'
  }, [])

  useEffect(() => {
    let cancelled = false

    Promise.all([
      fetchJson<StatsSummary>(`/api/stats/summary?${toParams(query)}`),
      fetchJson<ListResponse<GameRow>>(`/api/stats/games?${toParams(query, { limit: '100' })}`),
      fetchJson<ListResponse<SessionRow>>(`/api/stats/sessions?${toParams(query, { limit: '100' })}`),
    ])
      .then(([s, g, ss]) => {
        if (!cancelled) setLoaded({ key: requestKey, summary: s, games: g.rows, sessions: ss.rows, error: null })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoaded({
            key: requestKey,
            summary: null,
            games: [],
            sessions: [],
            error: e instanceof Error ? e.message : 'Could not load stats.',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [query, requestKey])

  const t = summary?.totals

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/95 px-4 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">AI Backgammon · Admin stats</h1>
            <p className="text-xs text-slate-400">Anonymous, cookieless. IPs are stored only as a daily-rotating salted hash. Raw rows are kept 90 days.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Period" className={SELECT} value={query.days} onChange={(e) => setQuery({ ...query, days: Number(e.target.value) })}>
              {[1, 7, 30, 90].map((d) => <option key={d} value={d}>Last {d} day{d === 1 ? '' : 's'}</option>)}
            </select>
            <input aria-label="Country code" placeholder="Country (e.g. BG)" maxLength={2} className={cn(SELECT, 'w-32 uppercase')} value={query.country} onChange={(e) => setQuery({ ...query, country: e.target.value.toUpperCase() })} />
            <select aria-label="Game mode" className={SELECT} value={query.mode} onChange={(e) => setQuery({ ...query, mode: e.target.value })}>
              <option value="">All modes</option>
              <option value="humanVsAi">Human vs AI</option>
              <option value="aiVsAi">AI vs AI</option>
            </select>
            <select aria-label="Outcome" className={SELECT} value={query.outcome} onChange={(e) => setQuery({ ...query, outcome: e.target.value })}>
              <option value="">Any outcome</option>
              <option value="finished">Finished</option>
              <option value="abandoned">Abandoned</option>
              <option value="in_progress">No end signal</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-300">
              <input type="checkbox" checked={query.bots} onChange={(e) => setQuery({ ...query, bots: e.target.checked })} /> Include bots
            </label>
            <button type="button" onClick={() => setRefreshCount((n) => n + 1)} className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700">
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden /> Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        {error !== null ? (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-300">
            <ShieldAlert className="size-5 shrink-0" aria-hidden /> {error}
          </div>
        ) : null}

        {t !== undefined ? (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6" aria-label="Summary">
              <Stat label="Sessions" value={t.sessions} hint="one per browser tab" />
              <Stat label="Unique visitors" value={t.uniqueVisitors} hint="distinct per day, by IP hash" />
              <Stat label="Played a game" value={`${t.sessionsWithGame}`} hint={t.sessions > 0 ? `${percent(t.sessionsWithGame / t.sessions)} of sessions` : undefined} />
              <Stat label="Games" value={t.games} hint={`${t.finished} finished · ${t.abandoned} abandoned · ${t.inProgress} no signal`} />
              <Stat label="Completion rate" value={percent(t.completionRate)} hint="finished ÷ (finished + abandoned)" />
              <Stat label="Avg. duration" value={duration(t.avgFinishedSeconds)} hint={`finished · abandoned ${duration(t.avgAbandonedSeconds)}`} />
            </section>

            <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" aria-label="Breakdowns">
              <DayChart rows={summary?.byDay ?? []} />
              <BarList title="Outcome" rows={summary?.byOutcome ?? []} />
              <BarList title="Countries" rows={summary?.byCountry ?? []} />
              <BarList title="Networks (AS)" rows={summary?.byAs ?? []} />
              <BarList title="Referrers" rows={summary?.byReferrer ?? []} />
              <BarList title="Game mode" rows={summary?.byMode ?? []} />
              <BarList title="AI provider" rows={summary?.byProvider ?? []} />
              <BarList title="AI errors" rows={summary?.aiErrors ?? []} />
              <BarList title="Board style" rows={summary?.byBoardStyle ?? []} />
              <BarList title="Devices" rows={summary?.byDevice ?? []} />
              <BarList title="Browsers" rows={summary?.byBrowser ?? []} />
            </section>
          </>
        ) : null}

        <section className={CARD} aria-label="Records">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" className="flex gap-1">
              {(['games', 'sessions'] as const).map((name) => (
                <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}
                  className={cn('rounded-md px-3 py-1 text-xs font-semibold capitalize', tab === name ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800')}>
                  {name}
                </button>
              ))}
            </div>
            <a href={`/api/stats/export?${toParams(query, { type: tab })}`} className="flex items-center gap-1 text-xs text-sky-400 hover:underline">
              <Download className="size-3.5" aria-hidden /> Export CSV
            </a>
          </div>

          <div className="overflow-x-auto">
            {tab === 'games' ? (
              <table className="min-w-full">
                <thead><tr><Th>Started (UTC)</Th><Th>Country</Th><Th>Network</Th><Th>Visitor</Th><Th>Mode</Th><Th>AI</Th><Th>Level</Th><Th>Outcome</Th><Th>Winner</Th><Th>Duration</Th><Th>Turns</Th><Th>Undo</Th><Th>Pause</Th><Th>Board</Th></tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {games.map((g) => (
                    <tr key={g.game_id}>
                      <Td>{when(g.started_at)}</Td>
                      <Td>{g.country ?? '??'}</Td>
                      <Td title={g.as_org ?? undefined}>{g.asn !== null ? `AS${g.asn}` : '—'}</Td>
                      <Td title="Daily-rotating salted hash">{g.ip_hash ?? '—'}</Td>
                      <Td>{g.mode}{g.match_type !== null ? ` / ${g.match_type}` : ''}</Td>
                      <Td title={g.ai_model ?? undefined}>{g.ai_provider ?? '—'}</Td>
                      <Td>{g.difficulty ?? '—'}</Td>
                      <Td><span className={OUTCOME_STYLE[g.outcome]}>{g.outcome}</span></Td>
                      <Td>{g.winner ?? '—'}</Td>
                      <Td>{duration(g.duration_s)}</Td>
                      <Td>{g.turns ?? '—'}</Td>
                      <Td>{g.undo_count ?? '—'}</Td>
                      <Td>{g.pause_count ?? '—'}</Td>
                      <Td>{g.board_style ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="min-w-full">
                <thead><tr><Th>First seen (UTC)</Th><Th>Country</Th><Th>Network</Th><Th>Visitor</Th><Th>Referrer</Th><Th>Device</Th><Th>Browser / OS</Th><Th>Lang</Th><Th>Games</Th><Th>Finished</Th><Th>Bot</Th></tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {sessions.map((s) => (
                    <tr key={s.session_id}>
                      <Td>{when(s.first_seen)}</Td>
                      <Td>{s.country ?? '??'}</Td>
                      <Td title={s.as_org ?? undefined}>{s.asn !== null ? `AS${s.asn}` : '—'}</Td>
                      <Td title="Daily-rotating salted hash">{s.ip_hash ?? '—'}</Td>
                      <Td>{s.referrer_host ?? 'direct'}</Td>
                      <Td>{s.device_type ?? '—'}</Td>
                      <Td>{s.browser ?? '—'} / {s.os ?? '—'}</Td>
                      <Td>{s.language ?? '—'}</Td>
                      <Td>{s.games_played}</Td>
                      <Td>{s.games_finished}</Td>
                      <Td>{s.is_bot === 1 ? 'yes' : ''}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loading && (tab === 'games' ? games.length === 0 : sessions.length === 0) ? (
              <p className="py-6 text-center text-xs text-slate-500">No records for these filters yet.</p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  )
}
