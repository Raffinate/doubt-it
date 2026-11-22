# Doubt It

Play Doubt It, the classic bluffing card game with a single-round, revolver-roulette twist, against
GTO-trained AI solvers or a friend in your browser.

## The game

20 cards, collapsed into two categories: **Face cards** (8 in the deck, the truthful claim) and
**Number cards** (12, the bluff). Specific ranks never matter. A **match** is an elimination duel that
can span several **rounds**, with each player's revolver chambers (6 at the start, public) carrying over
between rounds until someone actually dies.

Each round, both players are dealt 5 fresh cards. Round 1 of a match, the opener is a coin flip; after
that, whoever spun and survived the previous round responds, and the other player opens. On your turn,
play 1-3 cards face down (claimed as all Face cards) or call Doubt on the opponent's last play. The very
first play of a round can't be challenged, and if your opponent's hand is empty, calling Doubt is your
only legal move: every round resolves in exactly one call. The AI only ever plays all-Face or all-Number
(mixing never pays), but you may mix.

**Resolution**: whoever's wrong (the liar if caught, the caller if the play was truthful) spins the
revolver **alone**, once, at their own chambers: fatal 1 time in _n_ with _n_ chambers left. Die, and the
match ends. Survive, and the spinner's chambers drop by one and a fresh round is dealt. The other
player's chambers are untouched.

Being **correct** about a call and **surviving** the spin are tracked separately, the same way winning
an all-in doesn't mean the shove was +EV.

## Opponents

| Nickname     | Technical name     | Personality                                      |
| ------------ | ------------------ | ------------------------------------------------ |
| The Dealer   | `exact`            | Reads the table and the odds with equal calm.    |
| The Fatalist | `sudden_death`     | Every trigger pull is the only one that matters. |
| The Skeptic  | `always_call`      | Trusts nobody, calls everybody's bluff.          |
| The Gambler  | `always_bluff`     | Never met a lie it didn't like.                  |
| The Wildcard | `random`           | No pattern, no tell, no plan.                    |
| The Nit      | `cautious`         | Doesn't lie unless the truth runs out.           |
| The Paranoid | `nervous`          | The bigger the play, the louder the alarm bells. |
| The Trapper  | `exploit_cautious` | Knows the Nit's whole game before it's dealt.    |

All are CFR-solved or heuristic strategies computed by the
`holdemsolver` Rust project's Liar's Deck model and
exported as JSON lookup tables in `public/data/`. The list lives in `src/game/strategies.ts`;
`src/game/data.test.ts` checks every table still matches the client's key format.

## Regenerating strategy data

From the `holdemsolver` repo:

```sh
make doubt-it-strategies
```

That target copies the exported JSON into `WEB_REPO_DOUBT_IT`, which must point at
`../doubt-it/public/data`.

## Multiplayer

Peer-to-peer via WebRTC ([PeerJS](https://peerjs.com)). One player hosts and sends the invite link;
the other opens it or pastes it into Join. The host owns the authoritative game state, including every
random roll. The guest is a synced renderer that never samples its own outcome, so both sides always
agree on what happened.

## Develop

```sh
pnpm install
pnpm dev         # http://localhost:5173
pnpm test
pnpm typecheck
pnpm build
```

Stack: Solid 2, [ui-sdk](https://ui-sdk.dev) components styled with Tailwind 4, Vite. Same as the other
projects on [raffinate.github.io](https://raffinate.github.io/). The game rules and session state
machine (`src/game/`) are plain TypeScript with no UI dependencies; components in `src/components/`
render a snapshot of the session.

Analytics: cookieless PostHog (page views, clicks, and `game_started`, `match_ended`,
`multiplayer_connected` events), only on the deployed site. The light/dark choice is stored under the
same `theme` key as the blog, so it carries across the site.

## Deploy

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main`. In the
repository settings, set **Pages → Source** to **GitHub Actions**.

## License

Apache-2.0, see `LICENSE`.
