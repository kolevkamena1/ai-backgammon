import { useGameStore, type AiThought } from '@/state/gameStore'
import { useShallow } from 'zustand/react/shallow'

export interface AiThoughtState {
  thought: AiThought | null
  isAiThinking: boolean
  clearAiThought: () => void
}

/**
 * The streaming sentence on its own selector. `useGame` deliberately does NOT expose `aiThought`,
 * so a token landing repaints only the components that actually show it (`AiThoughtPanel`,
 * `GameLog`) — never the board or the controls around them. `useShallow` keeps this multi-field
 * object referentially stable whenever a store write changes none of the fields it returns.
 */
export function useAiThought(): AiThoughtState {
  return useGameStore(
    useShallow((state) => ({
      thought: state.aiThought,
      isAiThinking: state.isAiThinking,
      clearAiThought: state.clearAiThought,
    })),
  )
}
