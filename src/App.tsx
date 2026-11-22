import { Button } from "@ui-sdk/solid/button"
import { createMemo, createSignal, onCleanup, onSettled, Show } from "solid-js"
import { track } from "./analytics.ts"
import { ActionBar, Table } from "./components/Table.tsx"
import { HelpDialog } from "./components/HelpDialog.tsx"
import { History } from "./components/History.tsx"
import { FriendPanel, OpponentPanel, StatsPanel, type Phase } from "./components/Sidebar.tsx"
import { ThemeToggle } from "./components/ThemeToggle.tsx"
import { buttonClass, Panel } from "./components/ui.tsx"
import { host, inviteUrl, join, type Link, parseJoinId } from "./game/multiplayer.ts"
import { MAX_PLAY, selectionAction } from "./game/rules.ts"
import { canContinue, canTriggerSpin, humanToAct, mustCall, Session, type View } from "./game/session.ts"
import { FRIEND, loadStrategy, opponentName, opponents } from "./game/strategies.ts"

const OPPONENT_KEY = "doubt-it:opponent:v1"

function savedOpponent() {
  try {
    const id = localStorage.getItem(OPPONENT_KEY)
    if (id === FRIEND || opponents.some((o) => o.id === id)) return id!
  } catch {}
  return opponents[0].id
}

export function App() {
  const joinParam = new URLSearchParams(location.search).get("join")

  const [opponent, setOpponent] = createSignal(joinParam ? FRIEND : savedOpponent())
  const [phase, setPhase] = createSignal<Phase>("idle")
  const [error, setError] = createSignal<string | null>(null)
  const [invite, setInvite] = createSignal<string | null>(null)
  const [mpStatus, setMpStatus] = createSignal("")
  const [helpOpen, setHelpOpen] = createSignal(false)

  let link: Link | null = null
  const session = new Session({
    onChange: (v) => setView(v),
    onEvent: (e) => track("match_ended", { opponent: opponent(), result: e.won ? "won" : "lost", rounds: e.rounds }),
    send: (msg) => link?.send(msg),
  })
  const [view, setView] = createSignal<View>(session.view())

  // Selected card indices belong to one turn of one deal; a new deal or a new play clears them.
  const [picked, setPicked] = createSignal<{ turn: string; idx: number[] }>({ turn: "", idx: [] })
  const turnKey = () => `${view().deal}:${view().roundHistory.length}`
  const selected = createMemo(() => (picked().turn === turnKey() ? picked().idx : []))
  const selection = createMemo(() => {
    const hand = view().hand
    return hand ? selectionAction(hand, selected()) : null
  })
  const toggleCard = (i: number) => {
    if (!humanToAct(view()) || mustCall(view())) return
    const cur = selected()
    if (cur.includes(i)) setPicked({ turn: turnKey(), idx: cur.filter((x) => x !== i) })
    else if (cur.length < MAX_PLAY) setPicked({ turn: turnKey(), idx: [...cur, i] })
  }

  const play = () => {
    const action = selection()
    if (action) session.humanAct(action)
  }
  const call = () => session.humanAct({ type: "call" })
  const spin = () => session.triggerSpin()
  const next = () => session.continueAfterResult()

  const chooseOpponent = (id: string) => {
    setOpponent(id)
    setError(null)
    setMpStatus("")
    try {
      localStorage.setItem(OPPONENT_KEY, id)
    } catch {}
  }

  const stop = () => {
    link?.close()
    link = null
    session.stop()
    setPhase("idle")
    setInvite(null)
  }

  const connectionLost = () => {
    stop()
    setMpStatus("The connection closed.")
  }

  const start = () => {
    setError(null)
    if (opponent() === FRIEND) return void startHost()
    const id = opponent()
    setPhase("loading")
    loadStrategy(id)
      .then((table) => {
        if (phase() !== "loading" || opponent() !== id) return
        session.startSolo(table)
        setPhase("playing")
        track("game_started", { opponent: id })
      })
      .catch(() => {
        setPhase("idle")
        setError("Couldn't load this opponent's strategy. Check your connection and try again.")
      })
  }

  const startHost = async () => {
    setPhase("loading")
    setMpStatus("Starting…")
    try {
      link = await host({
        onId: (id) => {
          setInvite(inviteUrl(id))
          setMpStatus("Waiting for your friend to join…")
        },
        onOpen: () => {
          session.startHost()
          setPhase("playing")
          setInvite(null)
          setMpStatus("Connected. You're hosting.")
          track("multiplayer_connected", { role: "host" })
        },
        onMessage: (m) => session.receive(m),
        onClose: connectionLost,
        onError: (type) => setMpStatus(`Connection error: ${type}.`),
      })
    } catch {
      stop()
      setMpStatus("Couldn't reach the connection service. Try again.")
    }
  }

  const joinGame = async (raw: string) => {
    const id = parseJoinId(raw)
    if (!id) return
    setOpponent(FRIEND)
    setPhase("loading")
    setMpStatus("Connecting…")
    try {
      link = await join(id, {
        onOpen: () => {
          session.startGuest()
          setPhase("playing")
          setMpStatus("Connected to the host.")
          track("multiplayer_connected", { role: "guest" })
        },
        onMessage: (m) => session.receive(m),
        onClose: connectionLost,
        onError: (type) => {
          stop()
          setMpStatus(type === "peer-unavailable" ? "No game found at that link. Ask for a fresh one." : `Connection error: ${type}.`)
        },
      })
    } catch {
      stop()
      setMpStatus("Couldn't reach the connection service. Try again.")
    }
  }

  // Space plays the selection, spins or deals on; C calls. Text fields and the open dialog keep their keys.
  let swallowSpaceUp = false
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || helpOpen()) return
    const target = e.target as HTMLElement | null
    if (target?.closest("input, textarea, [contenteditable], [role=listbox], [data-slot=select-content]")) return
    const v = view()
    if (!v.playing || !v.chambers) return
    const key = e.key.toLowerCase()
    let handled = true
    if (key === " " || key === "enter") {
      if (canTriggerSpin(v) && key === " ") spin()
      else if (canContinue(v)) next()
      else if (key === " " && humanToAct(v) && !mustCall(v)) play()
      else handled = key === " " && target === document.body
    } else if (key === "c" && humanToAct(v) && v.lastPlay) {
      call()
    } else {
      handled = false
    }
    if (handled) {
      e.preventDefault()
      swallowSpaceUp = key === " "
    }
  }
  // A focused button would otherwise also activate on Space's keyup.
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " " && swallowSpaceUp) {
      e.preventDefault()
      swallowSpaceUp = false
    }
  }
  document.addEventListener("keydown", onKeyDown, true)
  document.addEventListener("keyup", onKeyUp, true)
  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown, true)
    document.removeEventListener("keyup", onKeyUp, true)
    link?.close()
  })

  onSettled(() => {
    if (joinParam) void joinGame(joinParam)
  })

  const name = () => (view().mode === "solo" ? opponentName(opponent()) : "Your friend")
  const atTable = () => view().playing && view().chambers !== null

  return (
    <div class="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <header class="mb-6">
        <div class="-my-1.5 flex items-center justify-between gap-4">
          <a
            href="https://raffinate.github.io/"
            class="text-xs font-medium text-muted-foreground hover:text-foreground"
            data-ph-capture-attribute-action="home"
          >
            ← Raffinate
          </a>
          <div class="flex items-center gap-1">
            <Button class={buttonClass.ghost} onClick={() => setHelpOpen(true)} data-ph-capture-attribute-action="help">
              How to play
            </Button>
            <ThemeToggle />
          </div>
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">Doubt It</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          The bluffing card game with a revolver twist. Play GTO-trained AI opponents or a friend.
        </p>
      </header>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="min-w-0 space-y-4">
          <Panel>
            <Show
              when={atTable()}
              fallback={
                <div class="flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl bg-felt p-6 text-center text-felt-foreground sm:min-h-[26rem]">
                  <p class="max-w-sm text-sm">
                    <Show when={view().playing} fallback={<>Pick an opponent and press <strong class="text-white">Start</strong>. Play cards face down claiming they're all Face cards, or call Doubt. Whoever's wrong spins the revolver.</>}>
                      Connected. Waiting for the host to deal…
                    </Show>
                  </p>
                  <Show when={!view().playing}>
                    <Button
                      class="rounded-md px-3 py-1.5 text-sm text-white underline underline-offset-4 outline-none hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/60"
                      onClick={() => setHelpOpen(true)}
                    >
                      Read the rules
                    </Button>
                  </Show>
                </div>
              }
            >
              <Table view={view()} opponentName={name()} selected={selected()} onToggle={toggleCard} />
              <div class="mt-4">
                <ActionBar
                  view={view()}
                  opponentName={name()}
                  selection={selection()?.hand ?? null}
                  onCall={call}
                  onPlay={play}
                  onSpin={spin}
                  onContinue={next}
                />
              </div>
            </Show>
          </Panel>
          <Show when={view().playing}>
            <History entries={view().history} />
          </Show>
        </div>

        {/* On a phone, the picker comes first until a game is on. */}
        <div class={["space-y-4", !atTable() && "max-lg:order-first"]}>
          <OpponentPanel
            opponent={opponent()}
            phase={phase()}
            error={error()}
            canNewSession={phase() === "playing" && view().mode !== "mp-guest"}
            onOpponent={chooseOpponent}
            onStart={start}
            onStop={stop}
            onNewSession={() => session.newSession()}
          />
          <Show when={opponent() === FRIEND}>
            <FriendPanel
              phase={phase()}
              inviteUrl={invite()}
              status={mpStatus()}
              defaultJoin={joinParam ?? ""}
              onJoin={(raw) => void joinGame(raw)}
            />
          </Show>
          <Show when={view().playing}>
            <StatsPanel stats={view().stats} />
          </Show>
        </div>
      </div>

      <footer class="mt-8 text-xs text-muted-foreground">
        Strategies from{" "}
        <a class="underline underline-offset-2 hover:text-foreground" href="https://github.com/Raffinate/holdem_solver">
          holdemsolver
        </a>
        . Source on{" "}
        <a class="underline underline-offset-2 hover:text-foreground" href="https://github.com/Raffinate/doubt-it">
          GitHub
        </a>
        .
      </footer>

      <HelpDialog open={helpOpen()} onOpenChange={setHelpOpen} />
    </div>
  )
}
