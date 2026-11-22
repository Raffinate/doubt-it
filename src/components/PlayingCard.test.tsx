// @vitest-environment happy-dom
import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { expect, test } from "vitest"
import type { Hand } from "../game/rules.ts"
import { OwnHand } from "./PlayingCard.tsx"

/**
 * Regression: the hand stays mounted between deals, and `<Repeat>` keeps existing cards. Number
 * cards used to keep the index they were created with, so after a deal with more Face cards a
 * Number card shared an index with a Face card: one tap lifted both, and the Number card could
 * never be selected on its own.
 */
test("each card keeps its own index after a new deal changes the Face count", () => {
  const root = document.createElement("div")
  document.body.append(root)
  const [hand, setHand] = createSignal<Hand>({ safe: 1, liar: 2 })
  const [selected, setSelected] = createSignal<number[]>([])
  const dispose = render(
    () => (
      <OwnHand
        hand={hand()}
        selected={selected()}
        interactive
        onToggle={(i) => setSelected((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))}
      />
    ),
    root,
  )
  flush()
  setHand({ safe: 3, liar: 2 })
  flush()

  const buttons = [...root.querySelectorAll("button")]
  const labels = () => buttons.map((b) => b.getAttribute("aria-label"))
  const pressed = () => buttons.map((b) => b.getAttribute("aria-pressed") === "true")
  expect(labels()).toEqual(["Face card", "Face card", "Face card", "Number card", "Number card"])

  buttons[1].click() // 2nd Face card
  flush()
  expect(selected()).toEqual([1])
  expect(pressed()).toEqual([false, true, false, false, false])

  buttons[3].click() // 1st Number card
  flush()
  expect(selected()).toEqual([1, 3])
  expect(pressed()).toEqual([false, true, false, true, false])

  dispose()
  root.remove()
})
