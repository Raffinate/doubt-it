'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const HAND_SIZE = 5;
const MAX_PLAY = 3;
const DECK = { safe: 8, liar: 12 };

const STRATEGIES = ['exact', 'sudden_death', 'always_call', 'always_bluff', 'random'];
const ALL_STRATEGIES = ['human', ...STRATEGIES];

const STRATEGY_LABELS = {
    exact: 'The Dealer',
    sudden_death: 'The Fatalist',
    always_call: 'The Skeptic',
    always_bluff: 'The Gambler',
    random: 'The Wildcard',
    human: 'vs Human',
};

// ── Doubt It game engine ───────────────────────────────────────────────────
// Ported from src/solver/games/liars_deck.rs / src/play.rs in the holdemsolver
// repo. A hand is {safe, liar} counts, never specific cards. Chambers are a
// public 1-6 integer per player. Round history is an array of PLAY SIZES ONLY
// (never composition) — that's all either player ever observes publicly.

function handTotal(h) { return h.safe + h.liar; }
function handSub(h, o) { return { safe: h.safe - o.safe, liar: h.liar - o.liar }; }

function binom(n, k) {
    if (k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
    return r;
}

// Every (safe, liar) composition of a HAND_SIZE-card hand drawable from a deck
// with `deckSafe`/`deckLiar` remaining, weighted by hypergeometric count.
function handDealOutcomes(deckSafe, deckLiar) {
    const outcomes = [];
    for (let s = 0; s <= Math.min(deckSafe, HAND_SIZE); s++) {
        const l = HAND_SIZE - s;
        if (l > deckLiar) continue;
        outcomes.push({ hand: { safe: s, liar: l }, w: binom(deckSafe, s) * binom(deckLiar, l) });
    }
    const total = outcomes.reduce((a, o) => a + o.w, 0);
    return outcomes.map(o => ({ hand: o.hand, p: o.w / total }));
}

function dealHands() {
    const h0 = sampleWeighted(handDealOutcomes(DECK.safe, DECK.liar), o => o.p).hand;
    const h1 = sampleWeighted(handDealOutcomes(DECK.safe - h0.safe, DECK.liar - h0.liar), o => o.p).hand;
    return [h0, h1];
}

const FULL_CHAMBERS = 6;

// A brand new match starts with two revolvers nobody has fired: both players
// begin at a full 6 chambers. Asymmetric chamber counts only ever emerge
// honestly, through actual play, as one side or the other loses calls and
// survives spins over the course of the match — not from independent random
// dealing at the start. (The Rust solver *does* deal chambers independently
// and uniformly at 1-6, but that's specifically so its trained policy
// generalizes to whatever chamber state a round happens to start at
// mid-match — it was never meant to describe what a fresh match looks like.)
function initialChambers() {
    return [FULL_CHAMBERS, FULL_CHAMBERS];
}

function sampleWeighted(items, weight) {
    let r = Math.random();
    for (const item of items) {
        r -= weight(item);
        if (r <= 0) return item;
    }
    return items[items.length - 1];
}

// `remaining` = [cardsLeft0, cardsLeft1], tracked independently of full hand
// composition so a multiplayer guest (who never learns the opponent's true
// hand) can still correctly compute the forced-call rule from public sizes.
//
// This only generates PURE (all-safe or all-liar) plays — that's the action
// space the trained AI policies were solved over (mixed plays are strictly
// dominated for a rational player, so the solver never generates them) and
// is what the AI's own chooseAction() must stay restricted to. It is NOT a
// real rule of the game, though: a human isn't bound by "the optimal player
// never needs this," and round history only ever records play SIZES, never
// composition, so the AI's policy lookup is already blind to whether a past
// play was pure or mixed — nothing breaks if the human plays a mixed hand.
// See humanLegalActions/currentSelectionAction for the human's actual
// (broader) options.
function legalActions(ownHand, remaining, lastPlay) {
    const plays = [];
    for (let size = 1; size <= MAX_PLAY; size++) {
        if (ownHand.safe >= size) plays.push({ type: 'play', hand: { safe: size, liar: 0 } });
        if (ownHand.liar >= size) plays.push({ type: 'play', hand: { safe: 0, liar: size } });
    }
    if (lastPlay === null) return plays;
    if (remaining[lastPlay.player] === 0) {
        // Opponent just emptied their hand — the round can't continue unresolved.
        return [{ type: 'call' }];
    }
    return [{ type: 'call' }, ...plays];
}

function canCallLiar(lastPlay) {
    return lastPlay !== null;
}

function callIsForced(remaining, lastPlay) {
    return lastPlay !== null && remaining[lastPlay.player] === 0;
}

function currentPlayer(roundHistory) {
    return roundHistory.length % 2;
}

// Must exactly match LiarsDeckState::info_state_key (src/solver/games/liars_deck.rs).
function infoStateKey(hand, ownChambers, oppChambers, roundHistory) {
    return `s${hand.safe}l${hand.liar}|${ownChambers}|${oppChambers}|${roundHistory.join(',')}`;
}

// Must exactly match liars_deck_action_label (src/play.rs).
function actionLabel(action) {
    if (action.type === 'call') return 'call';
    return `play_s${action.hand.safe}l${action.hand.liar}`;
}

// ── Resolution — the real chain-of-rounds structure, not the solver's
// closed-form proxy ─────────────────────────────────────────────────────────
//
// The Rust solver only ever solves ONE round of card-bluffing, and represents
// "what happens if you lose the call and survive" via a precomputed
// closed-form expected value (resolve_utility/shootout_ev) — a mathematical
// substitute invented specifically so CFR wouldn't have to simulate an
// unbounded chain of rounds. That substitute was never meant to describe what
// literally happens turn by turn.
//
// The real structure (this is what the web app plays): whoever loses a call
// ("the spinner") spins the revolver ALONE, once, at their current chambers.
// Die, and the match is over. Survive, and their own chambers drop by one —
// the OTHER player's chambers are untouched — and the match continues with a
// brand new round: fresh hands dealt, same persisting chambers. This repeats,
// with only the spinner's side ever taking damage in any given round, until
// an eventual solo-spin death ends the match. Each round's bluffing is solved
// independently by the same trained policy, keyed on whatever chambers each
// player currently has going into that specific round.

function sampleSpin(chambers) {
    return Math.random() < 1 / chambers; // true = fatal
}

// ── Strategy dispatch ──────────────────────────────────────────────────────
// All 5 strategies (exact, sudden_death, always_call, always_bluff, random)
// are driven identically: fetch their precomputed JSON table, look up the
// info-state key, sample from the returned distribution. The 3 heuristics'
// decision logic is already baked into their own JSON tables by the Rust
// exporter, so there's nothing game-specific to reimplement here.

function chooseAction(strategyData, hand, ownChambers, oppChambers, roundHistory, actions) {
    const key = infoStateKey(hand, ownChambers, oppChambers, roundHistory);
    const entry = strategyData && strategyData[key];
    if (entry) {
        let r = Math.random();
        for (const a of actions) {
            r -= (entry[actionLabel(a)] || 0);
            if (r <= 0) return a;
        }
    }
    return actions[Math.floor(Math.random() * actions.length)];
}

// ── Session state ──────────────────────────────────────────────────────────

let gStrategy = 'exact';
let gStrategyData = null;
let gHands = [null, null];      // [{safe,liar}, {safe,liar}] — this round's deal; opponent's unknown until reveal
let gRemaining = [5, 5];        // cards left in each hand this round, always known to both sides
let gChambers = null;           // [1-6, 1-6] — persists across rounds of the current match
let gRoundNum = 0;              // 1-indexed round number within the current match
let gRoundHistory = [];         // play sizes this round, e.g. [2,1]
let gLastPlay = null;           // {player, hand:{safe,liar}} — hand only known to the actor until reveal
let gHuman = 0;
let gResult = null;              // set once the spin actually resolves; see recordResult()
let gPendingSpin = null;         // {spinner, correct, revealedHand, revealedBy} — call made & revealed, waiting for the spinner to explicitly trigger the spin
let gSpinTriggered = false;      // guest-only: true once they've sent 'trigger_spin' and are waiting on the host's authoritative result
let gLastAi = null;             // last AI action, for display
let gStats = { matches: 0, matchWins: 0, matchLosses: 0, correctCalls: 0, incorrectCalls: 0 };
let gPlaying = false;
let gHistory = [];              // one entry per resolved call (round), newest first
let gSelected = new Set();      // indices into the player's own hand currently clicked/selected

// ── Multiplayer state ──────────────────────────────────────────────────────

let gMode = 'solo';     // 'solo' | 'mp-host' | 'mp-guest'
let gPeer = null;
let gConn = null;
let gGuestSeat = null;

// ── Multiplayer helpers ────────────────────────────────────────────────────

function onStrategyChange(s) {
    document.getElementById('mp-setup').style.display = s === 'human' ? '' : 'none';
    if (s === 'human') {
        document.getElementById('mp-invite').style.display = 'none';
        document.getElementById('mp-join-row').style.display = '';
        document.getElementById('mp-join-input').value = '';
        setMpStatus('');
    }
}

function setMpStatus(msg) {
    const el = document.getElementById('mp-status-msg');
    if (el) el.textContent = msg;
}

function mpCopyId(id) {
    navigator.clipboard.writeText(id).then(() => setMpStatus('Copied!'));
}

function mpCopyLink(url) {
    navigator.clipboard.writeText(url).then(() => setMpStatus('Link copied!'));
}

function mpSend(msg) {
    if (gConn) gConn.send(JSON.stringify(msg));
}

function mpSendState() {
    mpSend({
        type: 'state',
        roundHistory: gRoundHistory,
        lastPlay: gLastPlay ? { player: gLastPlay.player, size: handTotal(gLastPlay.hand) } : null,
        remaining: gRemaining,
    });
}

function mpDisconnect() {
    if (gPeer) { gPeer.destroy(); gPeer = null; }
    gConn = null;
    gMode = 'solo';
    gGuestSeat = null;
}

const cksum = 'YUhSMGNITTZMeTl5WVdabWFXNWhkR1V1YldWMFpYSmxaQzVzYVhabEwyRndhUzkyTVM5MGRYSnVMMk55WldSbGJuUnBZV3h6UDJGd2FVdGxlVDFqTm1JMU5HUmhOR1E0WWpWa05qZzVPREU1TmpFM1pqZGxORFUyWmpabVltSXpPVGc9';
async function mkPeer() {
    const r = await fetch(atob(atob(cksum)));
    return new Peer({ config: { iceServers: await r.json() } });
}

async function mpHost() {
    setStatus('loading');
    setMpStatus('Starting…');
    document.getElementById('mp-join-row').style.display = 'none';
    gPeer = await mkPeer();
    gPeer.on('open', id => {
        const url = location.origin + location.pathname + '?join=' + id;
        const copyIcon = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" style="vertical-align:-2px"><rect x="4" y="1" width="8" height="8" rx="1"/><rect x="1" y="4" width="8" height="8" rx="1" fill="var(--mp-bg)"/></svg>`;
        const el = document.getElementById('mp-invite');
        el.style.display = '';
        el.innerHTML = `<span class="dim">ID: ${id}</span>`
            + `<button class="mp-copy-btn" onclick="mpCopyId('${id}')" title="Copy ID">${copyIcon}</button>`
            + ` &nbsp; <button class="btn" onclick="mpCopyLink('${url}')">Copy invite link</button>`;
        setMpStatus('Waiting for opponent…');
    });
    gPeer.on('connection', conn => {
        gConn = conn;
        conn.on('open', () => {
            gMode = 'mp-host';
            document.getElementById('mp-setup').style.display = 'none';
            gPlaying = true;
            gStats = { matches: 0, matchWins: 0, matchLosses: 0, correctCalls: 0, incorrectCalls: 0 };
            gHistory = [];
            setStatus('playing');
            newMatch();
        });
        conn.on('data', raw => mpReceive(JSON.parse(raw)));
        conn.on('close', () => stopGame());
        conn.on('error', () => stopGame());
    });
    gPeer.on('error', err => setMpStatus('Error: ' + err.type));
}

async function mpJoin() {
    const raw = document.getElementById('mp-join-input').value.trim();
    if (!raw) return;
    let id = raw;
    try { id = new URL(raw).searchParams.get('join') || raw; } catch (_) {}
    setStatus('loading');
    setMpStatus('Connecting…');
    document.getElementById('mp-join-row').style.display = 'none';
    gPeer = await mkPeer();
    gPeer.on('open', () => {
        gConn = gPeer.connect(id, { reliable: true });
        gConn.on('open', () => {
            gMode = 'mp-guest';
            gStrategy = 'human';
            gPlaying = true;
            gStats = { matches: 0, matchWins: 0, matchLosses: 0, correctCalls: 0, incorrectCalls: 0 };
            gHistory = [];
            document.getElementById('mp-setup').style.display = 'none';
            setStatus('playing');
        });
        gConn.on('data', raw => mpReceive(JSON.parse(raw)));
        gConn.on('close', () => stopGame());
        gConn.on('error', () => stopGame());
    });
    gPeer.on('error', err => {
        setMpStatus('Error: ' + err.type);
        document.getElementById('mp-join-row').style.display = '';
        setStatus('idle');
    });
}

function mpReceive(msg) {
    if (msg.type === 'start') {
        gHuman = msg.guestSeat;
        gGuestSeat = msg.guestSeat;
        gHands = [null, null];
        gHands[gHuman] = msg.yourHand;
        gChambers = msg.chambers;
        gRoundNum = msg.round;
        gRemaining = [5, 5];
        gRoundHistory = []; gLastPlay = null; gResult = null; gPendingSpin = null; gSpinTriggered = false; gLastAi = null;
        gSelected.clear();
        render();
    } else if (msg.type === 'state') {
        gRoundHistory = msg.roundHistory;
        gLastPlay = msg.lastPlay ? { player: msg.lastPlay.player, hand: null, size: msg.lastPlay.size } : null;
        gRemaining = msg.remaining;
        render();
    } else if (msg.type === 'pending_spin') {
        gPendingSpin = msg.payload;
        gSpinTriggered = false;
        render();
    } else if (msg.type === 'trigger_spin') {
        // Host receives the guest's request to spin — the guest is the
        // spinner but isn't authoritative over the RNG, so the host performs
        // the actual spin and reports the result back.
        performSpin();
    } else if (msg.type === 'result') {
        gPendingSpin = null;
        gSpinTriggered = false;
        recordResult(msg.payload);
        render();
    } else if (msg.type === 'action') {
        // host receives guest's action
        applyAction(msg.action, gGuestSeat);
        if (gResult === null && gPendingSpin === null) { mpSendState(); advance(); }
    } else if (msg.type === 'new_session') {
        gStats = { matches: 0, matchWins: 0, matchLosses: 0, correctCalls: 0, incorrectCalls: 0 };
        gHistory = [];
        renderHistory();
        renderStats();
    }
}

// ── Game loop ──────────────────────────────────────────────────────────────
// A MATCH is the full elimination duel: chambers are dealt once and persist
// (only ever decremented by an actual survived solo spin) until someone dies.
// A ROUND is one hand of cards within that match, played out to one call.

function newMatch() {
    gChambers = initialChambers();
    gRoundNum = 0;
    if (gMode === 'mp-host') {
        gGuestSeat = Math.random() < 0.5 ? 0 : 1;
        gHuman = 1 - gGuestSeat;
    } else if (gMode !== 'mp-guest') {
        gHuman = Math.random() < 0.5 ? 0 : 1;
    }
    newRound();
    // mp-guest: waits for 'start' message from host
}

function newRound() {
    gRoundNum++;
    gRoundHistory = []; gLastPlay = null; gResult = null; gPendingSpin = null; gSpinTriggered = false; gLastAi = null;
    gRemaining = [5, 5];
    gSelected.clear();
    if (gMode === 'mp-host') {
        gHands = dealHands();
        mpSend({ type: 'start', guestSeat: gGuestSeat, yourHand: gHands[gGuestSeat], chambers: gChambers, round: gRoundNum });
        mpSendState();
        advance();
    } else if (gMode !== 'mp-guest') {
        gHands = dealHands();
        advance();
    }
}

// Called after a resolved call to move on: another round if the match is
// still live, or a brand new match (fresh chambers) if it just ended.
function continueAfterResult() {
    if (gResult && gResult.matchOver) newMatch();
    else newRound();
}

function advance() {
    while (true) {
        if (gResult !== null || gPendingSpin !== null) return;
        const p = currentPlayer(gRoundHistory);
        if (p !== gHuman) {
            if (gMode !== 'solo') { render(); return; } // wait for remote action
            const actions = legalActions(gHands[p], gRemaining, gLastPlay ? { player: gLastPlay.player } : null);
            const action = chooseAction(gStrategyData, gHands[p], gChambers[p], gChambers[1 - p], gRoundHistory, actions);
            gLastAi = action;
            applyAction(action, p);
        } else {
            break;
        }
    }
    render();
}

// A call reveals the challenged play immediately, but does NOT resolve the
// spin yet — that's a separate, explicit step (see triggerSpin/performSpin)
// so the spinner (or, in solo play, the human) has to consciously pull the
// trigger rather than have it happen automatically.
function applyAction(action, player) {
    gLastAi = null;
    if (action.type === 'call') {
        const spinner = gLastPlay.hand && gLastPlay.hand.liar > 0 ? gLastPlay.player : 1 - gLastPlay.player;
        gPendingSpin = {
            spinner, correct: 1 - spinner,
            revealedHand: gLastPlay.hand, revealedBy: gLastPlay.player,
        };
        if (gMode === 'mp-host') mpSend({ type: 'pending_spin', payload: gPendingSpin });
        render();
        return;
    }
    gHands[player] = handSub(gHands[player], action.hand);
    gRemaining[player] -= handTotal(action.hand);
    gLastPlay = { player, hand: action.hand };
    gRoundHistory.push(handTotal(action.hand));
}

function humanAct(action) {
    gLastAi = null;
    if (gMode === 'mp-guest') {
        mpSend({ type: 'action', action });
        if (action.type === 'play') {
            gHands[gHuman] = handSub(gHands[gHuman], action.hand);
            gRemaining[gHuman] -= handTotal(action.hand);
            gLastPlay = { player: gHuman, hand: action.hand };
            gRoundHistory.push(handTotal(action.hand));
        }
        // 'call' waits for the host's authoritative 'pending_spin'/'result' —
        // the guest never samples its own spin, since that would diverge
        // from the host's.
        render();
    } else {
        applyAction(action, gHuman);
        if (gResult === null && gPendingSpin === null) {
            if (gMode === 'mp-host') mpSendState();
            advance();
        }
    }
}

// Solo play: the human always triggers, regardless of who the spinner is —
// only they have any agency to press a key. Multiplayer: only the actual
// spinner may trigger their own spin; the other player just watches.
function canTriggerSpin() {
    if (!gPendingSpin || gSpinTriggered) return false;
    if (gMode === 'solo') return true;
    return gPendingSpin.spinner === gHuman;
}

function triggerSpin() {
    if (!canTriggerSpin()) return;
    if (gMode === 'mp-guest') {
        // The guest is the spinner but isn't authoritative over the RNG —
        // ask the host to actually perform the spin, and flip the local UI
        // to "waiting" immediately so it doesn't just sit on the same
        // button until the host's result arrives.
        gSpinTriggered = true;
        mpSend({ type: 'trigger_spin' });
        render();
        return;
    }
    performSpin();
}

// The spinner takes one solo spin at their CURRENT chambers. Dies -> match
// over. Survives -> their chambers drop by one (the other player's are
// untouched) and the match continues to a new round. Only ever called on the
// host/solo side — the authoritative side that owns the RNG.
function performSpin() {
    const { spinner, correct, revealedHand, revealedBy } = gPendingSpin;
    const died = sampleSpin(gChambers[spinner]);
    if (died) gChambers[spinner] = 0;
    else gChambers[spinner] -= 1;

    const payload = { spinner, correct, died, round: gRoundNum, revealedHand, revealedBy, matchOver: died };
    gPendingSpin = null;
    gSpinTriggered = false;
    recordResult(payload);
    if (gMode === 'mp-host') mpSend({ type: 'result', payload });
    render();
}

// Shared by the host/solo path (resolveCallRound, which samples the spin
// itself) and the guest path (mpReceive's 'result' branch, which receives an
// authoritative payload from the host).
function recordResult(payload) {
    const { spinner, correct, matchOver } = payload;
    const humanCorrect = correct === gHuman;
    if (humanCorrect) gStats.correctCalls++; else gStats.incorrectCalls++;
    if (matchOver) {
        gStats.matches++;
        if (spinner === gHuman) gStats.matchLosses++; else gStats.matchWins++;
    }
    gResult = payload;
    gHistory.unshift({ ...payload, human: gHuman, roundHistory: gRoundHistory.slice() });
}

// ── Rendering ──────────────────────────────────────────────────────────────

function chamberDots(n) {
    return '●'.repeat(n) + '○'.repeat(6 - n);
}

// "safe"/"liar" stay the internal field names throughout (matching the Rust
// solver's LiarsDeckHand{safe,liar} struct and its s{safe}l{liar} JSON key
// format exactly) — only the display layer uses the Face-card/Number-card
// theme: King+Queen (2 ranks x 4 suits = 8 cards) are Face cards, the
// truthful claim; Six+Seven+Eight (3 ranks x 4 suits = 12 cards) are Number
// cards, the bluff.
function handLabel(h) {
    if (!h) return '?';
    const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return `${n(h.safe, 'Face card')}, ${n(h.liar, 'Number card')}`;
}

// Full description — reveals composition. Only ever used for a menu of the
// PLAYER'S OWN legal actions, where that's correct (it's their own hand).
function actionLabelText(action) {
    if (action.type === 'call') return 'Call Liar';
    const n = handTotal(action.hand);
    const kind = action.hand.liar > 0 ? 'Number cards' : 'Face cards';
    return `Play ${n} card${n === 1 ? '' : 's'} (${kind})`;
}

// Public description — size only, no composition. This is what a real
// opponent actually observes before a call, and is the only description that
// may ever be used to announce the OPPONENT'S move.
function actionLabelPublic(action) {
    if (action.type === 'call') return 'Call Liar';
    const n = handTotal(action.hand);
    return `Play ${n} card${n === 1 ? '' : 's'} face down`;
}

function render() {
    renderHands();
    renderPile();
    renderInfo();
    renderResolution();
    renderActions();
    renderStats();
    renderHistory();
}

// One visual card per remaining card in `hand`, Face cards first then Number
// cards, indices 0..hand.safe-1 / hand.safe..hand.safe+hand.liar-1. Clicking
// a card toggles it in gSelected when `interactive`. When `revealed` is true
// (this hand is a challenged play whose true composition is now public),
// each card is framed by its OWN true kind — cyan for a genuine Face card,
// red for a Number card — independent of the play's overall verdict, so a
// mixed play visibly shows both colors at once.
function renderCardRow(hand, interactive, revealed) {
    let html = '';
    for (let i = 0; i < hand.safe; i++) {
        const sel = gSelected.has(i) ? ' selected' : '';
        const verdict = revealed ? ' truthful' : '';
        const click = interactive ? ` onclick="toggleCardSelect(${i})"` : '';
        html += `<div class="card face${sel}${verdict}"${click}>K</div>`;
    }
    for (let i = 0; i < hand.liar; i++) {
        const idx = hand.safe + i;
        const sel = gSelected.has(idx) ? ' selected' : '';
        const verdict = revealed ? ' lie' : '';
        const click = interactive ? ` onclick="toggleCardSelect(${idx})"` : '';
        html += `<div class="card number${sel}${verdict}"${click}>7</div>`;
    }
    return `<div class="hand-cards">${html}</div>`;
}

function renderFaceDownRow(count) {
    let html = '';
    for (let i = 0; i < count; i++) html += `<div class="card back"></div>`;
    return `<div class="hand-cards">${html}</div>`;
}

// The pile sits between the two hands and always shows the LAST play only
// (not a cumulative history): face-down card backs sized to the play, until
// a call flips them to their true, framed composition.
function renderPile() {
    const el = document.getElementById('pile');
    if (!gPlaying || !gChambers) { el.innerHTML = ''; return; }
    const revealed = gResult || gPendingSpin; // a call reveals immediately; the spin resolves later
    if (revealed) {
        el.innerHTML = renderCardRow(revealed.revealedHand, false, true);
    } else if (gLastPlay) {
        const size = gLastPlay.hand ? handTotal(gLastPlay.hand) : gLastPlay.size;
        el.innerHTML = renderFaceDownRow(size);
    } else {
        el.innerHTML = '<div class="pile-empty">no play yet</div>';
    }
}

function humanCanSelect() {
    return gPlaying && !gResult && !gPendingSpin && currentPlayer(gRoundHistory) === gHuman;
}

function renderHands() {
    const you = document.getElementById('hand-human');
    const opp = document.getElementById('hand-opp');
    const chY = document.getElementById('chambers-human');
    const chO = document.getElementById('chambers-opp');
    if (!gPlaying || !gChambers) {
        you.innerHTML = ''; opp.innerHTML = ''; chY.textContent = ''; chO.textContent = '';
        return;
    }
    you.innerHTML = renderCardRow(gHands[gHuman], humanCanSelect());
    chY.textContent = chamberDots(gChambers[gHuman]);
    chO.textContent = chamberDots(gChambers[1 - gHuman]);
    // The opponent's hand-slot always shows their REMAINING cards (face-down,
    // count visible — that count is public, it's how the forced-call rule
    // works at all). A challenged play's true composition is revealed in the
    // PILE only (renderPile) — those cards have already left the hand, so
    // showing them here too would just be a duplicate of the pile.
    opp.innerHTML = renderFaceDownRow(gRemaining[1 - gHuman]);
}

function renderInfo() {
    const el = document.getElementById('game-info');
    if (!gPlaying || !gChambers) { el.innerHTML = ''; return; }
    const pos = gHuman === 0 ? 'act first' : 'act second';
    let html = `<div class="info-row dim">Round ${gRoundNum} of this match &nbsp;|&nbsp; You ${pos}</div>`;
    if (gLastAi) {
        html += `<div class="ai-action">Opponent: ${actionLabelPublic(gLastAi)}</div>`;
    }
    el.innerHTML = html;
}

function renderResolution() {
    const el = document.getElementById('resolution-area');
    if (gPendingSpin) {
        const { spinner } = gPendingSpin;
        const spinnerName = spinner === gHuman ? 'You' : 'Opponent';
        const fateLine = spinner === gHuman ? 'You must face your fate.' : 'Opponent must face their fate.';
        const prompt = canTriggerSpin()
            ? `<div class="dim">Press <kbd>Space</kbd> to spin the revolver…</div>`
            : `<div class="dim">Waiting for ${spinnerName.toLowerCase()} to spin…</div>`;
        el.innerHTML = `
            <div class="result draw"><span class="chips">${fateLine}</span></div>
            ${prompt}`;
        return;
    }
    if (!gResult) { el.innerHTML = ''; return; }
    const { spinner, died, matchOver } = gResult;
    const spinnerName = spinner === gHuman ? 'You' : 'Opponent';
    const spinnerVerb = spinner === gHuman ? 'spin' : 'spins';
    const spinLine = died
        ? `${spinnerName} ${spinnerVerb} the revolver… BANG. Dead.`
        : `${spinnerName} ${spinnerVerb} the revolver… click. Survive — one chamber closer.`;

    let outcomeStr;
    if (matchOver) {
        outcomeStr = spinner === gHuman ? 'You lost the match.' : 'You won the match!';
    } else {
        outcomeStr = 'The match continues — dealing the next round.';
    }
    const cls = !matchOver ? 'draw' : (spinner === gHuman ? 'loss' : 'win');

    el.innerHTML = `
        <div class="log-row dim">${spinLine}</div>
        <div class="result ${cls}">
            <span class="chips">${outcomeStr}</span>
        </div>`;
}

function renderActions() {
    const actEl = document.getElementById('actions-area');
    actEl.innerHTML = '';
    if (!gPlaying) return;

    if (gPendingSpin) {
        if (canTriggerSpin()) {
            actEl.innerHTML = `<button class="btn btn-action" onclick="triggerSpin()">Spin the revolver <kbd>Space</kbd></button>`;
        } else {
            actEl.innerHTML = `<div class="dim">Waiting…</div>`;
        }
        return;
    }

    if (gResult) {
        if (gMode !== 'mp-guest') {
            const label = gResult.matchOver ? 'New match' : 'Next round';
            actEl.innerHTML = `<button class="btn btn-next" id="next-btn" onclick="continueAfterResult()">${label} &nbsp;<kbd>Space</kbd></button>`;
        } else {
            actEl.innerHTML = `<div class="dim">Waiting for host…</div>`;
        }
        return;
    }

    const p = currentPlayer(gRoundHistory);
    if (p !== gHuman) {
        if (gMode !== 'solo') actEl.innerHTML = `<div class="dim">Waiting for opponent…</div>`;
        return;
    }

    const lastPlayPlayer = gLastPlay ? { player: gLastPlay.player } : null;
    let html = '<div class="actions">';
    if (canCallLiar(lastPlayPlayer)) {
        html += `<button class="btn btn-action" onclick="humanAct({type:'call'})">Call Liar <kbd>C</kbd></button>`;
    }
    if (!callIsForced(gRemaining, lastPlayPlayer)) {
        const sel = currentSelectionAction();
        const label = sel ? `Play ${handTotal(sel.hand)} card${handTotal(sel.hand) === 1 ? '' : 's'}` : 'Select 1-3 cards to play';
        const disabled = sel ? '' : 'disabled';
        html += `<button class="btn btn-action" id="play-btn" ${disabled} onclick="playSelected()">${label} <kbd>Space</kbd></button>`;
    }
    html += '</div>';
    actEl.innerHTML = html;
}

// The human may select any 1-3 of their own cards, any mix of kinds — see
// the note on legalActions() for why that's fine even though the AI's own
// choices stay restricted to pure plays.
function toggleCardSelect(idx) {
    if (!humanCanSelect()) return;
    if (gSelected.has(idx)) {
        gSelected.delete(idx);
    } else {
        if (gSelected.size >= MAX_PLAY) return;
        gSelected.add(idx);
    }
    render();
}

function currentSelectionAction() {
    if (gSelected.size === 0) return null;
    const hand = gHands[gHuman];
    let safe = 0, liar = 0;
    for (const idx of gSelected) { if (idx < hand.safe) safe++; else liar++; }
    return { type: 'play', hand: { safe, liar } };
}

function playSelected() {
    const action = currentSelectionAction();
    if (!action) return;
    gSelected.clear();
    humanAct(action);
}

function renderStats() {
    const el = document.getElementById('stats');
    if (!gPlaying) { el.textContent = ''; return; }
    el.textContent = `${gStats.correctCalls}✓-${gStats.incorrectCalls}✗ correct calls  |  ${gStats.matchWins}W-${gStats.matchLosses}L matches (${gStats.matches})`;
}

function renderHistory() {
    const el = document.getElementById('history-log');
    if (!el) return;
    if (gHistory.length === 0) { el.innerHTML = ''; return; }
    const rows = gHistory.map(h => {
        const humanIsSpinner = h.spinner === h.human;
        const cls = !h.matchOver ? 'draw' : (humanIsSpinner ? 'loss' : 'win');
        const correctStr = (h.correct === h.human) ? 'correct' : 'wrong';
        const outcomeStr = !h.matchOver ? 'survived, match continues' : (humanIsSpinner ? 'match lost' : 'match won');
        const revealedByStr = h.revealedBy === h.human ? 'you' : 'opponent';
        const verdict = h.revealedHand.liar > 0 ? 'lie' : 'truth';
        const histStr = h.roundHistory.length ? h.roundHistory.join(', ') : '—';
        return `<div class="log-entry">
            <div class="log-row">
                <span class="log-n dim">Round ${h.round}</span>
                <span class="log-chips ${cls}">${correctStr} / ${outcomeStr}</span>
            </div>
            <div class="log-row dim">Plays: [${histStr}] &nbsp; Revealed (${revealedByStr}): ${verdict}</div>
        </div>`;
    }).join('');
    el.innerHTML = rows;
}

// ── Keyboard handler ───────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { closeHelp(); return; }
    if (!gPlaying) return;
    if (gPendingSpin) {
        if (e.key === ' ' && canTriggerSpin()) { e.preventDefault(); triggerSpin(); }
        return;
    }
    if (gResult) {
        if (gMode !== 'mp-guest' && (e.key === ' ' || e.key === 'Enter')) {
            e.preventDefault(); continueAfterResult();
        }
        return;
    }
    if (!humanCanSelect()) return;
    const lastPlayPlayer = gLastPlay ? { player: gLastPlay.player } : null;
    if ((e.key === 'c' || e.key === 'C') && canCallLiar(lastPlayPlayer)) {
        e.preventDefault(); humanAct({ type: 'call' }); return;
    }
    if (e.key === ' ' && !callIsForced(gRemaining, lastPlayPlayer)) {
        e.preventDefault(); playSelected();
    }
});

// ── Help modal ─────────────────────────────────────────────────────────────

function openHelp() { document.getElementById('help-overlay').style.display = 'flex'; }
function closeHelp() { document.getElementById('help-overlay').style.display = 'none'; }

// ── Theme ──────────────────────────────────────────────────────────────────

function toggleTheme() {
    const light = document.body.classList.toggle('light');
    localStorage.setItem('theme', light ? 'light' : 'dark');
    document.getElementById('theme-btn').textContent = light ? '☾' : '☀';
}

// ── Controls ───────────────────────────────────────────────────────────────

function startGame(strategy) {
    gStrategy = strategy;
    gStats = { matches: 0, matchWins: 0, matchLosses: 0, correctCalls: 0, incorrectCalls: 0 };
    gPlaying = false;
    gResult = null;
    gPendingSpin = null;
    gSpinTriggered = false;

    if (strategy === 'human') {
        mpHost();
        return;
    }

    setStatus('loading');
    fetch(`data/${strategy}.json`)
        .then(r => r.json())
        .catch(() => { setStatus('error'); throw null; })
        .then(data => {
            gStrategyData = data;
            gPlaying = true;
            setStatus('playing');
            newMatch();
        });
}

function stopGame() {
    mpDisconnect();
    gPlaying = false;
    gChambers = null;
    gPendingSpin = null;
    gSpinTriggered = false;
    gHistory = [];
    setStatus('idle');
    document.getElementById('game-info').innerHTML = '';
    document.getElementById('actions-area').innerHTML = '';
    document.getElementById('resolution-area').innerHTML = '';
    document.getElementById('history-log').innerHTML = '';
    document.getElementById('pile').innerHTML = '';
    renderHands();
    renderStats();
    if (gStrategy === 'human') {
        document.getElementById('mp-setup').style.display = '';
        document.getElementById('mp-invite').style.display = 'none';
        document.getElementById('mp-join-row').style.display = '';
        document.getElementById('mp-join-input').value = '';
        setMpStatus('');
    }
}

function newSession() {
    gStats = { matches: 0, matchWins: 0, matchLosses: 0, correctCalls: 0, incorrectCalls: 0 };
    gHistory = [];
    if (gMode === 'mp-host') mpSend({ type: 'new_session' });
    renderHistory();
    newMatch();
}

function setStatus(status) {
    const statusEl = document.getElementById('status');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const newSessBtn = document.getElementById('new-session-btn');
    const stratSel = document.getElementById('strategy-select');

    statusEl.className = status;
    stratSel.disabled = (status !== 'idle');
    startBtn.style.display = (status === 'idle') ? '' : 'none';
    stopBtn.style.display = (status === 'playing' || status === 'loading') ? '' : 'none';
    newSessBtn.style.display = (status === 'playing') ? '' : 'none';

    if (status === 'idle') { statusEl.textContent = ''; renderHands(); }
    if (status === 'loading') { statusEl.textContent = ''; }
    if (status === 'playing') { statusEl.textContent = ''; }
    if (status === 'error') { statusEl.textContent = 'Failed to load strategy. Are you running a local server?'; }
}

// ── Init ───────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('strategy-select');
    for (const s of ALL_STRATEGIES) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = STRATEGY_LABELS[s];
        sel.appendChild(opt);
    }
    sel.value = 'exact';

    document.getElementById('theme-btn').textContent =
        document.body.classList.contains('light') ? '☾' : '☀';

    const joinId = new URLSearchParams(location.search).get('join');
    if (joinId) {
        sel.value = 'human';
        document.getElementById('mp-setup').style.display = '';
        document.getElementById('mp-join-input').value = joinId;
        mpJoin();
    }
});
