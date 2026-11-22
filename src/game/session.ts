import {
  type Action,
  callIsForced,
  coinFlip,
  currentPlayer,
  chooseAction,
  dealHands,
  FULL_CHAMBERS,
  type Hand,
  handSub,
  handTotal,
  HAND_SIZE,
  isLie,
  legalActions,
  MAX_PLAY,
  other,
  type Pair,
  type Rng,
  type Seat,
  spinIsFatal,
  type StrategyTable,
} from "./rules.ts"

/**
 * A MATCH is the full elimination duel: chambers start full and persist, only ever dropping on a
 * survived solo spin, until someone dies. A ROUND is one deal of cards within that match, played out
 * to exactly one call.
 *
 * Resolution is the real chain-of-rounds structure, not the solver's closed-form proxy. The Rust
 * solver solves ONE round of bluffing and stands in for "lose the call and survive" with a
 * precomputed expected value, so CFR never simulates the unbounded chain. Here, whoever loses a call
 * (the spinner) spins ALONE, once, at their own chambers. Die and the match is over. Survive and only
 * their chambers drop by one, then a fresh round is dealt. Each round is played by the same trained
 * policy, keyed on the chambers going into it.
 *
 * Multiplayer: the host owns the authoritative state and every random roll. The guest is a synced
 * renderer that never samples its own outcome, so both sides always agree on what happened.
 */

export type Mode = "solo" | "mp-host" | "mp-guest"

export interface LastPlay {
  player: Seat
  /** Known only to whoever played it, until a call reveals it. */
  hand: Hand | null
  size: number
}

export interface PendingSpin {
  spinner: Seat
  correct: Seat
  revealedHand: Hand
  revealedBy: Seat
}

export interface SpinResult extends PendingSpin {
  died: boolean
  round: number
  matchOver: boolean
  /** Both players' chambers after the spin. */
  chambers?: Pair<number>
}

export interface HistoryEntry extends SpinResult {
  human: Seat
  roundHistory: number[]
}

export interface Stats {
  matches: number
  matchWins: number
  matchLosses: number
  correctCalls: number
  incorrectCalls: number
}

export interface View {
  mode: Mode
  playing: boolean
  human: Seat
  /** The human's own cards left this round. */
  hand: Hand | null
  remaining: Pair<number>
  chambers: Pair<number> | null
  round: number
  /** Increments on every deal, so per-turn UI state can tell rounds apart across matches. */
  deal: number
  starter: Seat
  roundHistory: readonly number[]
  lastPlay: LastPlay | null
  pendingSpin: PendingSpin | null
  spinTriggered: boolean
  result: SpinResult | null
  /** The opponent's last move as the human saw it: a size, never the cards. */
  opponentMove: OpponentMove | null
  stats: Stats
  history: readonly HistoryEntry[]
}

export type OpponentMove = { type: "call" } | { type: "play"; size: number }

export type Message =
  | { type: "start"; guestSeat: Seat; yourHand: Hand; chambers: Pair<number>; round: number; starter: Seat }
  | { type: "state"; roundHistory: number[]; lastPlay: { player: Seat; size: number } | null; remaining: Pair<number> }
  | { type: "pending_spin"; payload: PendingSpin }
  | { type: "trigger_spin" }
  | { type: "result"; payload: SpinResult }
  | { type: "action"; action: Action }
  | { type: "new_session" }

export type SessionEvent = { type: "match_end"; won: boolean; rounds: number }

const freshStats = (): Stats => ({ matches: 0, matchWins: 0, matchLosses: 0, correctCalls: 0, incorrectCalls: 0 })

export const turnOf = (v: View) => currentPlayer(v.roundHistory, v.starter)

/** The human may pick cards and act. */
export const humanToAct = (v: View) =>
  v.playing && v.chambers !== null && !v.result && !v.pendingSpin && turnOf(v) === v.human

export const mustCall = (v: View) => callIsForced(v.remaining, v.lastPlay?.player ?? null)

/** Solo: the human always pulls the trigger, whoever the spinner is. Multiplayer: only the spinner does. */
export function canTriggerSpin(v: View) {
  if (!v.pendingSpin || v.spinTriggered) return false
  return v.mode === "solo" || v.pendingSpin.spinner === v.human
}

/** The guest waits for the host to deal the next round. */
export const canContinue = (v: View) => v.result !== null && v.mode !== "mp-guest"

export interface SessionOptions {
  onChange: (view: View) => void
  onEvent?: (event: SessionEvent) => void
  send?: (msg: Message) => void
  rng?: Rng
}

export class Session {
  private mode: Mode = "solo"
  private playing = false
  private table: StrategyTable | null = null
  private hands: Pair<Hand | null> = [null, null]
  private remaining: Pair<number> = [HAND_SIZE, HAND_SIZE]
  private chambers: Pair<number> | null = null
  private round = 0
  private deal = 0
  private starter: Seat = 0
  private roundHistory: number[] = []
  private lastPlay: LastPlay | null = null
  private human: Seat = 0
  private guestSeat: Seat = 1
  private result: SpinResult | null = null
  private pendingSpin: PendingSpin | null = null
  private spinTriggered = false
  private opponentMove: OpponentMove | null = null
  private stats = freshStats()
  private history: HistoryEntry[] = []
  private readonly rng: Rng

  constructor(private readonly opts: SessionOptions) {
    this.rng = opts.rng ?? Math.random
  }

  view(): View {
    return {
      mode: this.mode,
      playing: this.playing,
      human: this.human,
      hand: this.hands[this.human] && { ...this.hands[this.human]! },
      remaining: [...this.remaining],
      chambers: this.chambers && [...this.chambers],
      round: this.round,
      deal: this.deal,
      starter: this.starter,
      roundHistory: [...this.roundHistory],
      lastPlay: this.lastPlay && { ...this.lastPlay },
      pendingSpin: this.pendingSpin,
      spinTriggered: this.spinTriggered,
      result: this.result,
      opponentMove: this.opponentMove,
      stats: { ...this.stats },
      history: [...this.history],
    }
  }

  private changed() {
    this.opts.onChange(this.view())
  }

  private send(msg: Message) {
    this.opts.send?.(msg)
  }

  /** Host → guest: the public round state. Never the composition of a play. */
  private sendState() {
    this.send({
      type: "state",
      roundHistory: [...this.roundHistory],
      lastPlay: this.lastPlay && { player: this.lastPlay.player, size: this.lastPlay.size },
      remaining: [...this.remaining],
    })
  }

  /** Play against an AI strategy table. */
  startSolo(table: StrategyTable) {
    this.reset("solo")
    this.table = table
    this.newMatch()
  }

  /** A guest connected: deal the first match. */
  startHost() {
    this.reset("mp-host")
    this.newMatch()
  }

  /** Connected to a host: wait for its "start". */
  startGuest() {
    this.reset("mp-guest")
    this.changed()
  }

  stop() {
    this.reset("solo")
    this.playing = false
    this.changed()
  }

  /** Clear stats and history, then start a fresh match. */
  newSession() {
    if (this.mode === "mp-guest") return
    this.stats = freshStats()
    this.history = []
    if (this.mode === "mp-host") this.send({ type: "new_session" })
    this.newMatch()
  }

  private reset(mode: Mode) {
    this.mode = mode
    this.playing = true
    this.table = null
    this.hands = [null, null]
    this.remaining = [HAND_SIZE, HAND_SIZE]
    this.chambers = null
    this.round = 0
    this.roundHistory = []
    this.lastPlay = null
    this.result = null
    this.pendingSpin = null
    this.spinTriggered = false
    this.opponentMove = null
    this.stats = freshStats()
    this.history = []
  }

  // Both revolvers start full. Asymmetric chambers only ever emerge through play. (The solver deals
  // chambers uniformly at 1-6 so its policy covers any mid-match state; that isn't how a match starts.)
  private newMatch() {
    this.chambers = [FULL_CHAMBERS, FULL_CHAMBERS]
    this.round = 0
    if (this.mode === "mp-host") {
      this.guestSeat = coinFlip(this.rng)
      this.human = other(this.guestSeat)
    } else {
      this.human = coinFlip(this.rng)
    }
    // Round 1 has no previous spin to pick an opener from: a fresh coin flip, not carried over.
    this.newRound(coinFlip(this.rng))
  }

  private newRound(starter: Seat) {
    this.round++
    this.deal++
    this.starter = starter
    this.roundHistory = []
    this.lastPlay = null
    this.result = null
    this.pendingSpin = null
    this.spinTriggered = false
    this.opponentMove = null
    this.remaining = [HAND_SIZE, HAND_SIZE]
    this.hands = dealHands(this.rng)
    if (this.mode === "mp-host") {
      this.send({
        type: "start",
        guestSeat: this.guestSeat,
        yourHand: this.hands[this.guestSeat]!,
        chambers: [...this.chambers!],
        round: this.round,
        starter,
      })
      this.sendState()
    }
    this.advance()
  }

  /**
   * After a resolved call: a new match if that spin was fatal, otherwise the next round. The spinner
   * just survived a scare and responds next round; the other player, who wasn't on the line, opens.
   */
  continueAfterResult() {
    if (!this.result || this.mode === "mp-guest") return
    if (this.result.matchOver) this.newMatch()
    else this.newRound(other(this.result.spinner))
  }

  /** Let the AI move until it's the human's turn or the round has been called. */
  private advance() {
    while (this.result === null && this.pendingSpin === null) {
      const p = currentPlayer(this.roundHistory, this.starter)
      if (p === this.human || this.mode !== "solo") break // multiplayer: wait for the remote action
      const hand = this.hands[p]!
      const actions = legalActions(hand, this.remaining, this.lastPlay?.player ?? null)
      const action = chooseAction(this.table, hand, this.chambers![p], this.chambers![other(p)], this.roundHistory, actions, this.rng)
      this.apply(action, p)
    }
    this.changed()
  }

  /**
   * A call reveals the challenged play at once but doesn't spin yet: the spinner (or, solo, the human)
   * pulls the trigger as a separate, deliberate step.
   */
  private apply(action: Action, player: Seat) {
    this.opponentMove =
      player === this.human ? null : action.type === "call" ? action : { type: "play", size: handTotal(action.hand) }
    if (action.type === "call") {
      const last = this.lastPlay!
      const spinner = isLie(last.hand!) ? last.player : other(last.player)
      this.pendingSpin = { spinner, correct: other(spinner), revealedHand: last.hand!, revealedBy: last.player }
      if (this.mode === "mp-host") this.send({ type: "pending_spin", payload: this.pendingSpin })
      return
    }
    this.hands[player] = handSub(this.hands[player]!, action.hand)
    this.remaining[player] -= handTotal(action.hand)
    this.lastPlay = { player, hand: action.hand, size: handTotal(action.hand) }
    this.roundHistory.push(handTotal(action.hand))
  }

  humanAct(action: Action) {
    if (!this.isLegalForHuman(action)) return
    if (this.mode === "mp-guest") {
      this.send({ type: "action", action })
      // A play is applied locally right away. A call waits for the host's authoritative
      // pending_spin/result: the guest never samples its own spin.
      if (action.type === "play") this.apply(action, this.human)
      this.changed()
      return
    }
    this.apply(action, this.human)
    this.afterAction()
  }

  private isLegalForHuman(action: Action) {
    const v = this.view()
    if (!humanToAct(v)) return false
    if (action.type === "call") return this.lastPlay !== null
    const n = handTotal(action.hand)
    const hand = this.hands[this.human]!
    return !mustCall(v) && n >= 1 && n <= MAX_PLAY && action.hand.safe <= hand.safe && action.hand.liar <= hand.liar
  }

  private afterAction() {
    if (this.result === null && this.pendingSpin === null && this.mode === "mp-host") this.sendState()
    this.advance()
  }

  triggerSpin() {
    if (!canTriggerSpin(this.view())) return
    if (this.mode === "mp-guest") {
      // The guest is the spinner but doesn't own the RNG: ask the host, and show "waiting" meanwhile.
      this.spinTriggered = true
      this.send({ type: "trigger_spin" })
      this.changed()
      return
    }
    this.performSpin()
  }

  /** The spinner takes one solo spin at their current chambers. Host/solo only: it owns the RNG. */
  private performSpin() {
    const pending = this.pendingSpin
    if (!pending || !this.chambers) return
    const died = spinIsFatal(this.chambers[pending.spinner], this.rng)
    this.chambers[pending.spinner] = died ? 0 : this.chambers[pending.spinner] - 1
    const payload: SpinResult = { ...pending, died, round: this.round, matchOver: died, chambers: [...this.chambers] }
    this.pendingSpin = null
    this.spinTriggered = false
    this.record(payload)
    if (this.mode === "mp-host") this.send({ type: "result", payload })
    this.changed()
  }

  private record(payload: SpinResult) {
    const { spinner, correct, matchOver } = payload
    if (correct === this.human) this.stats.correctCalls++
    else this.stats.incorrectCalls++
    if (matchOver) {
      this.stats.matches++
      if (spinner === this.human) this.stats.matchLosses++
      else this.stats.matchWins++
      this.opts.onEvent?.({ type: "match_end", won: spinner !== this.human, rounds: payload.round })
    }
    this.result = payload
    this.history.unshift({ ...payload, human: this.human, roundHistory: [...this.roundHistory] })
  }

  /** Handle a message from the peer. */
  receive(msg: Message) {
    if (!this.playing) return
    switch (msg.type) {
      // Guest side.
      case "start":
        this.human = msg.guestSeat
        this.hands = [null, null]
        this.hands[this.human] = msg.yourHand
        this.chambers = [...msg.chambers]
        this.round = msg.round
        this.deal++
        this.starter = msg.starter
        this.remaining = [HAND_SIZE, HAND_SIZE]
        this.roundHistory = []
        this.lastPlay = null
        this.result = null
        this.pendingSpin = null
        this.spinTriggered = false
        this.opponentMove = null
        break
      case "state":
        this.roundHistory = [...msg.roundHistory]
        this.remaining = [...msg.remaining]
        if (msg.lastPlay) {
          const mine = msg.lastPlay.player === this.human
          this.lastPlay = { ...msg.lastPlay, hand: mine ? (this.lastPlay?.hand ?? null) : null }
          this.opponentMove = mine ? null : { type: "play", size: msg.lastPlay.size }
        } else {
          this.lastPlay = null
          this.opponentMove = null
        }
        break
      case "pending_spin":
        this.pendingSpin = msg.payload
        this.opponentMove = msg.payload.revealedBy === this.human ? { type: "call" } : null
        this.spinTriggered = false
        break
      case "result":
        this.pendingSpin = null
        this.spinTriggered = false
        if (msg.payload.chambers) this.chambers = [...msg.payload.chambers]
        this.record(msg.payload)
        break
      case "new_session":
        this.stats = freshStats()
        this.history = []
        break
      // Host side.
      case "action":
        if (this.mode !== "mp-host" || this.result || this.pendingSpin) return
        if (currentPlayer(this.roundHistory, this.starter) !== this.guestSeat) return
        this.apply(msg.action, this.guestSeat)
        this.afterAction()
        return
      case "trigger_spin":
        if (this.mode === "mp-host" && this.pendingSpin?.spinner === this.guestSeat) this.performSpin()
        return
    }
    this.changed()
  }
}
