// @vitest-environment jsdom
import { useAiThought } from '@/hooks/useAiThought'
import { useGame } from '@/hooks/useGame'
import { useGameStore } from '@/state/gameStore'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGameStore.getState().resetGame()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('aiThought isolation (P1 regression)', () => {
  it('does not re-render useGame consumers when a streamed token lands, but does repaint the thought selector', () => {
    let gameRenders = 0
    let thoughtRenders = 0

    function GameProbe() {
      useGame()
      gameRenders += 1
      return null
    }
    function ThoughtProbe() {
      useAiThought()
      thoughtRenders += 1
      return null
    }

    act(() => {
      root.render(
        <>
          <GameProbe />
          <ThoughtProbe />
        </>,
      )
    })
    const gameBefore = gameRenders
    const thoughtBefore = thoughtRenders

    // A streamed token: only aiThought changes, nothing else in the store.
    act(() => {
      useGameStore.setState({ aiThought: { seat: 'light', text: 'I build a prime.', phase: 'streaming' } })
    })

    // useGame must NOT subscribe aiThought: the board and controls stay put across every token.
    expect(gameRenders).toBe(gameBefore)
    // The dedicated selector is the one place that repaints.
    expect(thoughtRenders).toBeGreaterThan(thoughtBefore)
  })
})