import type { StrategyTable } from "./rules.ts"

export interface Opponent {
  /** File name in public/data/, as exported by holdemsolver. */
  id: string
  name: string
  blurb: string
}

/** CFR-solved or heuristic strategies from holdemsolver's Liar's Deck model, all shipped as lookup tables. */
export const opponents: Opponent[] = [
  { id: "exact", name: "The Dealer", blurb: "Reads the table and the odds with equal calm." },
  { id: "sudden_death", name: "The Fatalist", blurb: "Every trigger pull is the only one that matters." },
  { id: "always_call", name: "The Skeptic", blurb: "Trusts nobody, calls everybody's bluff." },
  { id: "always_bluff", name: "The Gambler", blurb: "Never met a lie it didn't like." },
  { id: "random", name: "The Wildcard", blurb: "No pattern, no tell, no plan." },
  { id: "cautious", name: "The Nit", blurb: "Doesn't lie unless the truth runs out." },
  { id: "nervous", name: "The Paranoid", blurb: "The bigger the play, the louder the alarm bells." },
  { id: "exploit_cautious", name: "The Trapper", blurb: "Knows the Nit's whole game before it's dealt." },
]

/** Select value for playing a friend over WebRTC instead of an AI. */
export const FRIEND = "human"

export const opponentName = (id: string) =>
  id === FRIEND ? "Your friend" : (opponents.find((o) => o.id === id)?.name ?? id)

const cache = new Map<string, Promise<StrategyTable>>()

/** Fetch a strategy table once per page. The exporter wraps it under "strategy", beside "meta" and "state". */
export function loadStrategy(id: string): Promise<StrategyTable> {
  let p = cache.get(id)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ strategy: StrategyTable }>
      })
      .then((data) => data.strategy)
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}
