/**
 * Doubt It rules, ported from src/solver/games/liars_deck.rs and src/play.rs in the holdemsolver repo.
 *
 * A hand is {safe, liar} counts, never specific cards. Chambers are a public 1-6 integer per player.
 * Round history is an array of PLAY SIZES ONLY (never composition): that's all either player ever
 * observes publicly.
 *
 * "safe"/"liar" stay the internal names throughout, matching the solver's LiarsDeckHand{safe,liar}
 * and its s{safe}l{liar} key format exactly. Only the display layer uses the card theme: King+Queen
 * (8 cards) are Face cards, the truthful claim; Six+Seven+Eight (12 cards) are Number cards, the bluff.
 */

export const HAND_SIZE = 5
export const MAX_PLAY = 3
export const FULL_CHAMBERS = 6
const DECK = { safe: 8, liar: 12 }

export type Seat = 0 | 1
export type Pair<T> = [T, T]
export type Rng = () => number

export interface Hand {
  safe: number
  liar: number
}

export type Action = { type: "call" } | { type: "play"; hand: Hand }

/** A strategy table: info-state key → action label → probability. */
export type StrategyTable = Record<string, Record<string, number>>

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0)
export const handTotal = (h: Hand) => h.safe + h.liar
export const handSub = (h: Hand, o: Hand): Hand => ({ safe: h.safe - o.safe, liar: h.liar - o.liar })
export const isLie = (h: Hand) => h.liar > 0
export const coinFlip = (rng: Rng): Seat => (rng() < 0.5 ? 0 : 1)

function binom(n: number, k: number) {
  if (k > n) return 0
  k = Math.min(k, n - k)
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

function sampleWeighted<T>(items: T[], weight: (item: T) => number, rng: Rng): T {
  let r = rng()
  for (const item of items) {
    r -= weight(item)
    if (r <= 0) return item
  }
  return items[items.length - 1]
}

/** Every composition of a HAND_SIZE-card hand drawable from the remaining deck, hypergeometrically weighted. */
export function handDealOutcomes(deckSafe: number, deckLiar: number): { hand: Hand; p: number }[] {
  const outcomes: { hand: Hand; w: number }[] = []
  for (let s = 0; s <= Math.min(deckSafe, HAND_SIZE); s++) {
    const l = HAND_SIZE - s
    if (l > deckLiar) continue
    outcomes.push({ hand: { safe: s, liar: l }, w: binom(deckSafe, s) * binom(deckLiar, l) })
  }
  const total = outcomes.reduce((a, o) => a + o.w, 0)
  return outcomes.map((o) => ({ hand: o.hand, p: o.w / total }))
}

export function dealHands(rng: Rng): Pair<Hand> {
  const h0 = sampleWeighted(handDealOutcomes(DECK.safe, DECK.liar), (o) => o.p, rng).hand
  const h1 = sampleWeighted(handDealOutcomes(DECK.safe - h0.safe, DECK.liar - h0.liar), (o) => o.p, rng).hand
  return [h0, h1]
}

/**
 * The AI's legal actions: PURE (all-safe or all-liar) plays only. That's the action space the trained
 * policies were solved over (mixed plays are strictly dominated, so the solver never generates them).
 * It is not a rule of the game: the human may play any mix, see `selectionAction`. Round history only
 * records play sizes, so the AI's lookup is blind to whether a past play was pure or mixed.
 *
 * `remaining` is tracked separately from hand composition so a multiplayer guest, who never learns
 * the opponent's hand, can still apply the forced-call rule from public sizes.
 */
export function legalActions(ownHand: Hand, remaining: Pair<number>, lastPlayBy: Seat | null): Action[] {
  const plays: Action[] = []
  for (let size = 1; size <= MAX_PLAY; size++) {
    if (ownHand.safe >= size) plays.push({ type: "play", hand: { safe: size, liar: 0 } })
    if (ownHand.liar >= size) plays.push({ type: "play", hand: { safe: 0, liar: size } })
  }
  if (lastPlayBy === null) return plays
  if (remaining[lastPlayBy] === 0) return [{ type: "call" }]
  return [{ type: "call" }, ...plays]
}

/** The opponent just emptied their hand: the round can't continue unresolved. */
export const callIsForced = (remaining: Pair<number>, lastPlayBy: Seat | null) =>
  lastPlayBy !== null && remaining[lastPlayBy] === 0

export const currentPlayer = (roundHistory: readonly number[], starter: Seat): Seat =>
  ((starter + roundHistory.length) % 2) as Seat

/** Must exactly match LiarsDeckState::info_state_key (src/solver/games/liars_deck.rs). */
export function infoStateKey(hand: Hand, ownChambers: number, oppChambers: number, roundHistory: readonly number[]) {
  return `s${hand.safe}l${hand.liar}|${ownChambers}|${oppChambers}|${roundHistory.join(",")}`
}

/** Must exactly match liars_deck_action_label (src/play.rs). */
export function actionKey(action: Action) {
  return action.type === "call" ? "call" : `play_s${action.hand.safe}l${action.hand.liar}`
}

/**
 * Look up the info state and sample from its distribution. Every strategy, CFR-solved or heuristic,
 * ships as the same kind of table; a missing key falls back to a uniformly random legal action.
 */
export function chooseAction(
  table: StrategyTable | null,
  hand: Hand,
  ownChambers: number,
  oppChambers: number,
  roundHistory: readonly number[],
  actions: Action[],
  rng: Rng,
): Action {
  const entry = table?.[infoStateKey(hand, ownChambers, oppChambers, roundHistory)]
  if (entry) {
    let r = rng()
    for (const a of actions) {
      r -= entry[actionKey(a)] ?? 0
      if (r <= 0) return a
    }
  }
  return actions[Math.floor(rng() * actions.length)]
}

/** One solo spin at the given chambers. True = fatal. */
export const spinIsFatal = (chambers: number, rng: Rng) => rng() < 1 / chambers

/**
 * The play described by selected card indices into `hand`: Face cards are indices
 * 0..safe-1, Number cards safe..safe+liar-1. Any mix of 1-3 is allowed for the human.
 */
export function selectionAction(hand: Hand, selected: readonly number[]): Extract<Action, { type: "play" }> | null {
  if (selected.length === 0) return null
  const safe = selected.filter((i) => i < hand.safe).length
  return { type: "play", hand: { safe, liar: selected.length - safe } }
}
