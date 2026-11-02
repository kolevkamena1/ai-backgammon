import Modal from '@/components/ui/Modal'
import { Dices, ExternalLink, ShieldCheck } from 'lucide-react'

interface AboutModalProps {
  onClose: () => void
}

export const GITHUB_REPO_URL = 'https://github.com/kolevkamena1/ai-backgammon'
export const GITHUB_README_URL = 'https://github.com/kolevkamena1/ai-backgammon#readme'

export default function AboutModal({ onClose }: AboutModalProps) {
  return (
    <Modal
      titleId="about-title"
      title="About AI Backgammon"
      subtitle="Version 0.1.0 · Bring Your Own Key"
      icon={Dices}
      onClose={onClose}
      panelClassName="max-w-lg"
    >
      <div className="space-y-4 text-xs text-slate-300">
        <p className="leading-relaxed">
          <strong>AI Backgammon</strong> is a full-featured web backgammon engine featuring sequence-level
          rules enforcement, authentic physical board materials, responsive drag-and-drop checker movement,
          and pair-play with modern AI models.
        </p>

        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sky-400 font-medium">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            <span>Local & Private BYOK Architecture</span>
          </div>
          <p className="text-slate-400 leading-normal">
            Your API keys and settings are stored strictly in this browser&rsquo;s <code>localStorage</code>.
            Inference requests communicate directly with your selected AI provider (OpenAI, Anthropic, Google,
            or local custom gateways like Ollama & vLLM) without intermediate tracking servers.
          </p>
        </div>

        <div className="space-y-1.5 text-slate-400">
          <p>
            <strong>Board Designs:</strong> Levantine Marquetry, Crystal Lucite, Savile Bridle Leather,
            Aegean Tide Resin, and Gatsby Art Deco Marble.
          </p>
          <p>
            <strong>Controls:</strong> Click-to-move, drag-and-drop, interactive board resizing on all edges and corners.
          </p>
        </div>

        <div className="pt-2 flex items-center justify-between border-t border-slate-800">
          <a
            href={GITHUB_README_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 transition hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            <span>View README on GitHub</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-3 py-1.5 font-medium text-slate-100 hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

