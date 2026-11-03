import Modal from '@/components/ui/Modal'
import {
  Brain,
  Code2,
  Dices,
  ExternalLink,
  Gamepad2,
  Globe,
  ShieldCheck,
  Sparkles,
  Swords,
  User,
} from 'lucide-react'

interface AboutModalProps {
  onClose: () => void
}

export const GITHUB_REPO_URL = 'https://github.com/kolevkamena1/ai-backgammon'
export const GITHUB_README_URL = 'https://github.com/kolevkamena1/ai-backgammon#readme'
export const AUTHOR_WEBSITE_URL = 'https://www.kamenonline.com'

export default function AboutModal({ onClose }: AboutModalProps) {
  return (
    <Modal
      titleId="about-title"
      title="About AI Backgammon"
      subtitle="Version 0.1.0 · Bring Your Own Key"
      icon={Dices}
      onClose={onClose}
      panelClassName="max-w-xl"
    >
      <div className="space-y-4 text-xs text-slate-300">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 mb-1.5 flex items-center gap-1.5">
            <Sparkles className="size-4 text-amber-400" aria-hidden />
            Why AI Backgammon?
          </h3>
          <p className="leading-relaxed text-slate-400">
            AI Backgammon was created at the intersection of a 5,000-year-old classic game of strategy and modern
            generative AI. It is designed around four key purposes:
          </p>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-100">
              <Gamepad2 className="size-4 text-sky-400 shrink-0" aria-hidden />
              <span>For Backgammon Enthusiasts</span>
            </div>
            <p className="text-slate-400 leading-normal">
              Enjoy authentic, sequence-level backgammon rules against an AI sparring partner anytime — with
              intuitive drag-and-drop moves, live pip counts, and resizable handcrafted boards.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-100">
              <Brain className="size-4 text-emerald-400 shrink-0" aria-hidden />
              <span>Learn & Explore AI Models</span>
            </div>
            <p className="text-slate-400 leading-normal">
              A hands-on laboratory to explore how models think. Adjust temperature, reasoning levels, and
              context windows, or customize system prompts to forge unique playing personalities.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-100">
              <Swords className="size-4 text-amber-400 shrink-0" aria-hidden />
              <span>Model vs Model Arena</span>
            </div>
            <p className="text-slate-400 leading-normal">
              Pit two different engines or configurations against each other (BYOK 1 vs BYOK 2) to benchmark how
              different AI architectures reason through tactical decisions in real time.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-100">
              <Dices className="size-4 text-purple-400 shrink-0" aria-hidden />
              <span>Just for Fun</span>
            </div>
            <p className="text-slate-400 leading-normal">
              No paywalls, no ads, no accounts, and no pressure. Just the pure pleasure of rolling the dice on
              beautiful Levant, Lucite, Leather, Resin, and Art Deco boards.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-sky-400 font-medium">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            <span>Local & Private BYOK Architecture</span>
          </div>
          <p className="text-slate-400 leading-normal">
            Your API keys and settings never leave your browser. Requests go directly from your machine to your
            chosen cloud provider (OpenAI, Anthropic, Google) or your own local endpoints (Ollama, vLLM, LM Studio).
          </p>
          <p className="text-slate-400 leading-normal">
            <span className="font-medium text-slate-300">Anonymous usage stats:</span> the site owner sees
            aggregate, cookieless statistics — country, network, device type, game mode, and whether games are
            finished. Your IP address is only stored as a daily-rotating salted hash, and your API keys, prompts
            and moves are never sent. Browser Do Not Track settings are honoured: visitors who ask not
            to be tracked are not counted at all.
          </p>
        </div>

        {/* Developer & Author Attribution */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-slate-100 font-semibold">
              <User className="size-4 text-sky-400 shrink-0" aria-hidden />
              <span>Author & Developer</span>
            </div>
            <span className="font-semibold text-slate-200">Kamen Kolev</span>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1.5 border-t border-slate-800/80 text-xs">
            <a
              href={AUTHOR_WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 hover:underline transition"
            >
              <Globe className="size-3.5" aria-hidden />
              <span>www.kamenonline.com</span>
              <ExternalLink className="size-3 text-slate-500" aria-hidden />
            </a>

            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 hover:underline transition"
            >
              <Code2 className="size-3.5" aria-hidden />
              <span>GitHub Repository</span>
              <ExternalLink className="size-3 text-slate-500" aria-hidden />
            </a>
          </div>
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
            className="rounded-lg bg-slate-800 px-3.5 py-1.5 font-medium text-slate-100 hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
