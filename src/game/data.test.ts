import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { actionKey, infoStateKey, legalActions, type StrategyTable } from "./rules.ts"
import { opponents } from "./strategies.ts"

// If the export format or key scheme drifts, every lookup misses and the AI silently plays uniformly
// at random. These checks catch that.
describe.each(opponents)("data/$id.json", ({ id }) => {
  const file = JSON.parse(readFileSync(new URL(`../../public/data/${id}.json`, import.meta.url), "utf8")) as {
    strategy: StrategyTable
  }

  it("has a strategy table keyed like the client", () => {
    expect(Object.keys(file.strategy).length).toBeGreaterThan(1000)
    expect(file.strategy[infoStateKey({ safe: 2, liar: 3 }, 6, 6, [])]).toBeDefined()
    expect(file.strategy[infoStateKey({ safe: 1, liar: 4 }, 3, 5, [2])]).toBeDefined()
  })

  it("only uses action labels the client produces", () => {
    const entry = file.strategy[infoStateKey({ safe: 2, liar: 3 }, 6, 6, [2])]
    const labels = legalActions({ safe: 2, liar: 3 }, [5, 3], 1).map(actionKey)
    for (const [label, p] of Object.entries(entry)) if (p > 0) expect(labels).toContain(label)
  })
})
