# Doubt It

Play Doubt It — the classic bluffing card game, with a single-round, revolver-roulette twist — against GTO-trained AI solvers in your browser.

No build step, no framework, no dependencies beyond a CDN script for multiplayer. Just static files.

## Running locally

```
python3 -m http.server 8080
```

Then open `http://localhost:8080`. A local server is required (not `file://`) because the strategy files are loaded via `fetch()`, which browsers block under `file://` due to CORS.

## The game

20 cards, collapsed into two categories: **Safe** (8 in the deck) and **Liar** (12 in the deck) — specific ranks never matter, only whether a card is safe or a lie. A **match** is an elimination duel between two players that can span several **rounds** of cards, with each player's revolver chambers (1-6, dealt once, public) carrying over between rounds until someone actually dies.

Each round, both players are dealt 5 fresh cards, shown only as a safe/liar count. Round 1 of a match, the opener is a coin flip; after that, whoever spun and survived the previous round sits out the opening move, and the other player opens. On your turn, play 1-3 cards face down (claimed as all safe) or call Doubt on the opponent's last play. A play must be all-safe or all-liar — mixing is never useful. The very first play of a round can't be challenged, and if your opponent's hand is empty, calling Doubt is your only legal move — every round resolves in exactly one call.

**Resolution**, once a call happens: whoever's wrong (the liar if caught, the wrongful caller if the play was truthful) — "the spinner" — spins the revolver **alone**, once, at their own current chambers. The other player's chambers are untouched. Die, and the match ends. Survive, and the spinner's own chambers drop by one, then the match continues: a fresh round is dealt, with both players' chambers exactly as they now stand. This repeats — only the spinner's side ever takes damage in a given round — until an eventual solo spin ends the match.

Being **correct** about a call and **surviving** that round's spin are two different things, tracked separately — the same way winning an all-in in poker doesn't mean the shove was +EV. A correct call can still end in death if your own chambers are unlucky.

## Strategies

| Nickname | Technical name | Personality |
|---|---|---|
| The Dealer | `exact` | Reads the table and the odds with equal calm. |
| The Fatalist | `sudden_death` | Every trigger pull is the only one that matters. |
| The Skeptic | `always_call` | Trusts nobody, calls everybody's bluff. |
| The Gambler | `always_bluff` | Never met a lie it didn't like. |
| The Wildcard | `random` | No pattern, no tell, no plan. |

All 5 are CFR-solved or heuristic strategies computed by the [`holdemsolver`](https://github.com/Raffinate/holdem_solver) Rust project's Liar's Deck game model and exported as JSON lookup tables in `data/`.

## Regenerating strategy data

From the `holdemsolver` repo:

```
make doubt-it-strategies
```

Trains all 5 strategies at 800 CFR iterations and writes JSON directly to `../doubt-it/data/`. `exact` is the slow one (~15-20 minutes); the others train in well under a minute. To regenerate a single strategy in isolation:

```
cargo run --release -- precompute liars_deck --out-dir ../doubt-it/data --strategy exact -i 800
```

## Multiplayer

Peer-to-peer via WebRTC (PeerJS). One player starts as host (generates an invite link), the other joins by pasting the link or the raw peer ID. The host owns the authoritative game state, including the random resolution rolls — the guest is a synced passive renderer that never independently samples its own outcome, so both sides always agree on what happened.

## License

Apache-2.0, see `LICENSE`.
