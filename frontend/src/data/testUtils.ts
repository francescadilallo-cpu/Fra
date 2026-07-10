/**
 * Minimal hook-testing helpers — enough to exercise data hooks in jsdom
 * without pulling in @testing-library. Not a general-purpose harness.
 */
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

export function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result = { current: undefined as T }
  function Probe() {
    result.current = hook()
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(createElement(Probe))
  })
  return { result }
}

export async function waitFor(assertion: () => void, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (err) {
      lastError = err
      // Flush pending promises/effects between polls.
      await act(async () => {
        await new Promise(res => setTimeout(res, 25))
      })
    }
  }
  throw lastError
}
