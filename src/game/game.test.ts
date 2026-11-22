import { describe, expect, it } from "vitest"
import {
  actionKey,
  chooseAction,
  handDealOutcomes,
  infoStateKey,
  legalActions,
  selectionAction,
  type Rng,
} from "./rules.ts"
import { canTriggerSpin, humanToAct, type Message, Session, turnOf, type View } from "./session.ts"

/** Deterministic xorshift RNG in [0, 1). */
function seeded(seed: number): Rng {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 2 ** 32
  }
}

describe("rules", () => {
  it("weights deals hypergeometrically", () => {
    const outcomes = handDealOutcomes(8, 12)
    expect(outcomes.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1)
    expect(outcomes.every((o) => o.hand.safe + o.hand.liar === 5)).toBe(true)
  })

  it("matches the solver's key formats", () => {
    expect(infoStateKey({ safe: 2, liar: 3 }, 6, 4, [2, 1])).toBe("s2l3|6|4|2,1")
    expect(infoStateKey({ safe: 0, liar: 5 }, 1, 1, [])).toBe("s0l5|1|1|")
    expect(actionKey({ type: "call" })).toBe("call")
    expect(actionKey({ type: "play", hand: { safe: 0, liar: 2 } })).toBe("play_s0l2")
  })

  it("offers pure plays, a call once something's played, and only a call when the opponent is empty", () => {
    const hand = { safe: 1, liar: 4 }
    expect(legalActions(hand, [5, 5], null).map(actionKey)).toEqual(["play_s1l0", "play_s0l1", "play_s0l2", "play_s0l3"])
    expect(legalActions(hand, [5, 2], 1).map(actionKey)[0]).toBe("call")
    expect(legalActions(hand, [5, 0], 1).map(actionKey)).toEqual(["call"])
  })

  it("samples from the strategy table", () => {
    const actions = legalActions({ safe: 2, liar: 3 }, [5, 4], 1)
    const table = { "s2l3|6|6|1": { play_s0l2: 1 } }
    expect(actionKey(chooseAction(table, { safe: 2, liar: 3 }, 6, 6, [1], actions, seeded(3)))).toBe("play_s0l2")
  })

  it("lets the human mix kinds", () => {
    expect(selectionAction({ safe: 2, liar: 3 }, [1, 2, 4])).toEqual({ type: "play", hand: { safe: 1, liar: 2 } })
    expect(selectionAction({ safe: 2, liar: 3 }, [])).toBeNull()
  })
})

/** Play the human's turn with the first legal pure action, or spin/continue. */
function step(s: Session, v: View) {
  if (canTriggerSpin(v)) return s.triggerSpin()
  if (v.result) return s.continueAfterResult()
  if (humanToAct(v)) {
    const [first] = legalActions(v.hand!, v.remaining, v.lastPlay?.player ?? null)
    s.humanAct(first)
  }
}

describe("solo session", () => {
  it("plays whole matches to completion with consistent stats", () => {
    let view!: View
    const ends: boolean[] = []
    const s = new Session({
      onChange: (v) => (view = v),
      onEvent: (e) => ends.push(e.won),
      rng: seeded(42),
    })
    s.startSolo({})
    for (let i = 0; i < 5000 && ends.length < 20; i++) step(s, view)
    expect(ends.length).toBe(20)
    expect(view.stats.matches).toBe(20)
    expect(view.stats.matchWins + view.stats.matchLosses).toBe(20)
    expect(view.stats.matchWins).toBe(ends.filter(Boolean).length)
    expect(view.stats.correctCalls + view.stats.incorrectCalls).toBe(view.history.length)
  })

  it("starts each match with full revolvers and only drains the spinner's", () => {
    let view!: View
    const s = new Session({ onChange: (v) => (view = v), rng: seeded(7) })
    s.startSolo({})
    expect(view.chambers).toEqual([6, 6])
    for (let i = 0; i < 500 && !view.result; i++) step(s, view)
    const r = view.result!
    expect(view.chambers![r.correct]).toBe(6)
    expect(view.chambers![r.spinner]).toBe(r.died ? 0 : 5)
  })

  it("ignores an illegal play", () => {
    let view!: View
    const s = new Session({ onChange: (v) => (view = v), rng: seeded(11) })
    s.startSolo({})
    while (!humanToAct(view)) step(s, view)
    const before = view.roundHistory.length
    s.humanAct({ type: "play", hand: { safe: 4, liar: 0 } })
    expect(view.roundHistory.length).toBe(before)
  })
})

describe("multiplayer session", () => {
  it("keeps host and guest in sync through several rounds", () => {
    let hostView!: View
    let guestView!: View
    const toGuest: Message[] = []
    const toHost: Message[] = []
    const host = new Session({ onChange: (v) => (hostView = v), send: (m) => toGuest.push(m), rng: seeded(5) })
    const guest = new Session({ onChange: (v) => (guestView = v), send: (m) => toHost.push(m), rng: seeded(99) })
    const pump = () => {
      while (toGuest.length || toHost.length) {
        // Messages go through JSON like the real connection.
        while (toGuest.length) guest.receive(JSON.parse(JSON.stringify(toGuest.shift())))
        while (toHost.length) host.receive(JSON.parse(JSON.stringify(toHost.shift())))
      }
    }
    guest.startGuest()
    host.startHost()
    pump()

    let results = 0
    for (let i = 0; i < 3000 && results < 15; i++) {
      expect(guestView.human).toBe(1 - hostView.human)
      expect(guestView.roundHistory).toEqual(hostView.roundHistory)
      expect(guestView.remaining).toEqual(hostView.remaining)
      expect(guestView.chambers).toEqual(hostView.chambers)
      expect(turnOf(guestView)).toBe(turnOf(hostView))
      if (hostView.result) {
        results++
        expect(guestView.result).toEqual(hostView.result)
        host.continueAfterResult()
      } else if (hostView.pendingSpin) {
        // Exactly one side may pull the trigger.
        expect(canTriggerSpin(hostView) !== canTriggerSpin(guestView)).toBe(true)
        if (canTriggerSpin(hostView)) host.triggerSpin()
        else guest.triggerSpin()
      } else {
        step(humanToAct(hostView) ? host : guest, humanToAct(hostView) ? hostView : guestView)
      }
      pump()
    }
    expect(results).toBe(15)
    expect(guestView.stats.correctCalls).toBe(hostView.stats.incorrectCalls)
    expect(guestView.stats.matchWins).toBe(hostView.stats.matchLosses)
  })
})
