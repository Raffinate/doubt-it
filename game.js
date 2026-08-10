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

function dealChambers() {
    return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
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

function actionsEqual(a, b) {
    if (a.type !== b.type) return false;
    if (a.type === 'call') return true;
    return a.hand.safe === b.hand.safe && a.hand.liar === b.hand.liar;
}

// ── Resolution — actually simulated, not the closed-form EV the solver uses ──
//
// The Rust solver collapses this into a precomputed expected value purely
// because CFR has to re-walk it every training iteration and there's no
// player decision inside it. The web app plays one concrete match at a time,
// so it samples the real two-phase process step by step: the Liar-call loser
// ("the spinner") spins alone first; if they survive, both players fire
// simultaneously each round until someone (or both) actually dies. This is
// guaranteed to terminate — every "both survive" strictly decreases both
// remaining chambers, so within at most min(a,b) rounds one side reaches
// certain death and the shootout must resolve.

function sampleInitialSpin(chambers) {
    return Math.random() < 1 / chambers; // true = fatal
}

function sampleShootoutRound(a, b) {
    const aDies = Math.random() < 1 / a;
    const bDies = Math.random() < 1 / b;
    if (aDies && bDies) return 'both_die';
    if (aDies) return 'a_dies';
    if (bDies) return 'b_dies';
    return 'both_survive';
}

// Returns { log: [...steps], outcome: 'spinner_dies'|'other_dies'|'both_die' }.
// `spinner`/`other` are player indices; `log` entries carry enough detail to
// render/replay the sequence step by step.
function resolveCall(chambers, spinner) {
    const other = 1 - spinner;
    const log = [];
    let a = chambers[spinner], b = chambers[other];

    const spinnerDied = sampleInitialSpin(a);
    log.push({ step: 'initial_spin', spinner, died: spinnerDied });
    if (spinnerDied) return { log, outcome: 'spinner_dies' };

    a -= 1;
    while (true) {
        const result = sampleShootoutRound(a, b);
        log.push({ step: 'shootout', a, b, result });
        if (result === 'both_survive') { a -= 1; b -= 1; continue; }
        if (result === 'a_dies') return { log, outcome: 'spinner_dies' };
        if (result === 'b_dies') return { log, outcome: 'other_dies' };
        return { log, outcome: 'both_die' };
    }
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
let gHands = [null, null];      // [{safe,liar}, {safe,liar}] — opponent's may be unknown (multiplayer guest)
let gRemaining = [5, 5];        // cards left in each hand, always known to both sides
let gChambers = null;           // [1-6, 1-6]
let gRoundHistory = [];         // play sizes this match, e.g. [2,1]
let gLastPlay = null;           // {player, hand:{safe,liar}} — hand only known to the actor until reveal
let gLastPlaySize = null;       // publicly known size of gLastPlay, tracked separately for the guest
let gHuman = 0;
let gResult = null;             // set once a call resolves; see recordResult()
let gLastAi = null;             // last AI action, for display
let gStats = { hands: 0, correct: 0, incorrect: 0, survived: 0, died: 0, doubleDied: 0 };
let gPlaying = false;
let gHistory = [];              // hand-history log, unshifted newest-first

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
            gStats = { hands: 0, correct: 0, incorrect: 0, survived: 0, died: 0, doubleDied: 0 };
            gHistory = [];
            setStatus('playing');
            newHand();
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
            gStats = { hands: 0, correct: 0, incorrect: 0, survived: 0, died: 0, doubleDied: 0 };
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
        gRemaining = [5, 5];
        gRoundHistory = []; gLastPlay = null; gResult = null; gLastAi = null;
        render();
    } else if (msg.type === 'state') {
        gRoundHistory = msg.roundHistory;
        gLastPlay = msg.lastPlay ? { player: msg.lastPlay.player, hand: null, size: msg.lastPlay.size } : null;
        gRemaining = msg.remaining;
        render();
    } else if (msg.type === 'result') {
        recordResult(msg.spinner, msg.correct, msg.resolution, msg.revealedHand, msg.revealedBy);
        render();
    } else if (msg.type === 'action') {
        // host receives guest's action
        applyAction(msg.action, gGuestSeat);
        if (gResult === null) { mpSendState(); advance(); }
    } else if (msg.type === 'new_session') {
        gStats = { hands: 0, correct: 0, incorrect: 0, survived: 0, died: 0, doubleDied: 0 };
        gHistory = [];
        renderHistory();
        renderStats();
    }
}

// ── Game loop ──────────────────────────────────────────────────────────────

function newHand() {
    gRoundHistory = []; gLastPlay = null; gResult = null; gLastAi = null;
    gRemaining = [5, 5];
    if (gMode === 'mp-host') {
        gGuestSeat = Math.random() < 0.5 ? 0 : 1;
        gHuman = 1 - gGuestSeat;
        gHands = dealHands();
        gChambers = dealChambers();
        mpSend({ type: 'start', guestSeat: gGuestSeat, yourHand: gHands[gGuestSeat], chambers: gChambers });
        mpSendState();
        advance();
    } else if (gMode !== 'mp-guest') {
        gHuman = Math.random() < 0.5 ? 0 : 1;
        gHands = dealHands();
        gChambers = dealChambers();
        advance();
    }
    // mp-guest: waits for 'start' message from host
}

function advance() {
    while (true) {
        if (gResult !== null) return;
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

function applyAction(action, player) {
    gLastAi = null;
    if (action.type === 'call') {
        const spinner = gLastPlay.hand && gLastPlay.hand.liar > 0 ? gLastPlay.player : 1 - gLastPlay.player;
        finishHand(spinner);
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
        // 'call' waits for the host's authoritative 'result' — the guest never
        // samples its own resolution, since that would diverge from the host's.
        render();
    } else {
        applyAction(action, gHuman);
        if (gMode === 'mp-host' && gResult === null) mpSendState();
        if (gResult === null) advance();
    }
}

// Compute stats/history/gResult from an authoritative (spinner, correct,
// resolution, revealedHand, revealedBy) tuple. Shared by the host/solo path
// (finishHand, which samples the resolution itself) and the guest path
// (mpReceive's 'result' branch, which receives it from the host).
function recordResult(spinner, correct, resolution, revealedHand, revealedBy) {
    const other = 1 - spinner;
    const humanCorrect = correct === gHuman;
    let humanDied = false, oppDied = false;
    if (resolution.outcome === 'spinner_dies') { spinner === gHuman ? humanDied = true : oppDied = true; }
    else if (resolution.outcome === 'other_dies') { other === gHuman ? humanDied = true : oppDied = true; }
    else { humanDied = true; oppDied = true; } // both_die

    gStats.hands++;
    if (humanCorrect) gStats.correct++; else gStats.incorrect++;
    if (humanDied && oppDied) gStats.doubleDied++;
    else if (humanDied) gStats.died++;
    else if (oppDied) gStats.survived++;

    gResult = { spinner, correct, resolution, humanDied, oppDied, revealedHand, revealedBy };
    gHistory.unshift({
        n: gStats.hands, correct: humanCorrect, humanDied, oppDied,
        revealedHand, revealedBy, roundHistory: gRoundHistory.slice(), human: gHuman,
    });
}

function finishHand(spinner) {
    const correct = 1 - spinner;
    const resolution = resolveCall(gChambers, spinner);
    recordResult(spinner, correct, resolution, gLastPlay.hand, gLastPlay.player);
    if (gMode === 'mp-host') {
        mpSend({
            type: 'result', spinner, correct, resolution,
            revealedHand: gLastPlay.hand, revealedBy: gLastPlay.player,
        });
    }
    render();
}

function nextHand() { newHand(); }

// ── Rendering ──────────────────────────────────────────────────────────────

function chamberDots(n) {
    return '●'.repeat(n) + '○'.repeat(6 - n);
}

function handLabel(h) {
    if (!h) return '?';
    return `${h.safe} safe, ${h.liar} liar`;
}

function actionLabelText(action) {
    if (action.type === 'call') return 'Call Liar';
    const n = handTotal(action.hand);
    const kind = action.hand.liar > 0 ? 'liar' : 'safe';
    return `Play ${n} card${n === 1 ? '' : 's'} (${kind})`;
}

function render() {
    renderHands();
    renderInfo();
    renderResolution();
    renderActions();
    renderStats();
    renderHistory();
}

function renderHands() {
    const you = document.getElementById('hand-human');
    const opp = document.getElementById('hand-opp');
    const chY = document.getElementById('chambers-human');
    const chO = document.getElementById('chambers-opp');
    if (!gPlaying || !gChambers) {
        you.textContent = ''; opp.textContent = ''; chY.textContent = ''; chO.textContent = '';
        return;
    }
    you.textContent = handLabel(gHands[gHuman]);
    chY.textContent = chamberDots(gChambers[gHuman]);
    chO.textContent = chamberDots(gChambers[1 - gHuman]);
    if (gResult) {
        opp.textContent = gResult.revealedBy === (1 - gHuman) ? handLabel(gResult.revealedHand) : '(not challenged)';
    } else {
        opp.textContent = '? cards face down';
    }
}

function renderInfo() {
    const el = document.getElementById('game-info');
    if (!gPlaying || !gChambers) { el.innerHTML = ''; return; }
    const pos = gHuman === 0 ? 'act first' : 'act second';
    let html = `<div class="info-row dim">You ${pos} this match</div>`;
    if (gRoundHistory.length > 0) {
        html += `<div class="history">Plays so far (sizes): [${gRoundHistory.join(', ')}]</div>`;
    }
    if (gLastAi) {
        html += `<div class="ai-action">Opponent: ${actionLabelText(gLastAi)}</div>`;
    }
    el.innerHTML = html;
}

function resolutionStepText(step, spinner, other, humanIs) {
    const name = p => p === humanIs ? 'You' : 'Opponent';
    if (step.step === 'initial_spin') {
        const who = name(step.spinner);
        return step.died ? `${who} spin the revolver alone… BANG. Dead.`
                          : `${who} spin the revolver alone… click. Survive — one chamber closer.`;
    }
    // shootout
    if (step.result === 'both_survive') return `Both fire — both survive. Chambers tighten, they fire again.`;
    if (step.result === 'a_dies') return `Both fire — ${name(spinner)} is hit. Dead.`;
    if (step.result === 'b_dies') return `Both fire — ${name(other)} is hit. Dead.`;
    return `Both fire — both hit. A grim split.`;
}

function renderResolution() {
    const el = document.getElementById('resolution-area');
    if (!gResult) { el.innerHTML = ''; return; }
    const { spinner, correct, resolution, humanDied, oppDied, revealedHand, revealedBy } = gResult;
    const other = 1 - spinner;
    const revealedByStr = revealedBy === gHuman ? 'Your' : "Opponent's";
    const verdict = revealedHand.liar > 0 ? 'a LIE' : 'truthful';
    const correctStr = correct === gHuman ? 'You were' : 'Opponent was';
    let outcomeStr;
    if (humanDied && oppDied) outcomeStr = 'Both fell — a grim split.';
    else if (humanDied) outcomeStr = 'You died.';
    else if (oppDied) outcomeStr = 'Opponent died. You survive.';
    else outcomeStr = 'Survived.';

    const steps = resolution.log.map(s => `<div class="log-row dim">${resolutionStepText(s, spinner, other, gHuman)}</div>`).join('');

    const cls = humanDied ? 'loss' : oppDied ? 'win' : 'draw';
    el.innerHTML = `
        <div class="reveal">${revealedByStr} challenged play is revealed: ${verdict} (${handLabel(revealedHand)})</div>
        ${steps}
        <div class="result ${cls}">
            <span class="chips">${correctStr} correct</span>
            <span class="desc">${outcomeStr}</span>
        </div>`;
}

function renderActions() {
    const actEl = document.getElementById('actions-area');
    actEl.innerHTML = '';
    if (!gPlaying) return;

    if (gResult) {
        if (gMode !== 'mp-guest') {
            actEl.innerHTML = `<button class="btn btn-next" id="next-btn" onclick="nextHand()">Next hand &nbsp;<kbd>Space</kbd></button>`;
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

    const actions = legalActions(gHands[gHuman], gRemaining, gLastPlay ? { player: gLastPlay.player } : null);
    const btns = actions.map((a, i) => {
        const hk = i + 1;
        return `<button class="btn btn-action" onclick="humanAct(${JSON.stringify(a).replace(/"/g, '&quot;')})">${actionLabelText(a)} <kbd>${hk}</kbd></button>`;
    }).join('');
    actEl.innerHTML = `<div class="actions">${btns}</div>`;
}

function renderStats() {
    const el = document.getElementById('stats');
    if (!gPlaying) { el.textContent = ''; return; }
    el.textContent = `${gStats.correct}✓-${gStats.incorrect}✗ correct  |  ${gStats.survived}W-${gStats.died}L-${gStats.doubleDied}D  (${gStats.hands} hands)`;
}

function renderHistory() {
    const el = document.getElementById('history-log');
    if (!el) return;
    if (gHistory.length === 0) { el.innerHTML = ''; return; }
    const rows = gHistory.map(h => {
        const cls = h.humanDied ? 'loss' : h.oppDied ? 'win' : 'draw';
        const correctStr = h.correct ? 'correct' : 'wrong';
        const outcomeStr = h.humanDied && h.oppDied ? 'both fell' : h.humanDied ? 'you died' : h.oppDied ? 'opponent died' : 'survived';
        const revealedByStr = h.revealedBy === h.human ? 'you' : 'opponent';
        const verdict = h.revealedHand.liar > 0 ? 'lie' : 'truth';
        const histStr = h.roundHistory.length ? h.roundHistory.join(', ') : '—';
        return `<div class="log-entry">
            <div class="log-row">
                <span class="log-n dim">#${h.n}</span>
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
    if (gResult) {
        if (gMode !== 'mp-guest' && (e.key === ' ' || e.key === 'Enter')) {
            e.preventDefault(); nextHand();
        }
        return;
    }
    const p = currentPlayer(gRoundHistory);
    if (p !== gHuman) return;
    const actions = legalActions(gHands[gHuman], gRemaining, gLastPlay ? { player: gLastPlay.player } : null);
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= 0 && idx < actions.length) { e.preventDefault(); humanAct(actions[idx]); }
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
    gStats = { hands: 0, correct: 0, incorrect: 0, survived: 0, died: 0, doubleDied: 0 };
    gPlaying = false;
    gResult = null;

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
            newHand();
        });
}

function stopGame() {
    mpDisconnect();
    gPlaying = false;
    gChambers = null;
    gHistory = [];
    setStatus('idle');
    document.getElementById('game-info').innerHTML = '';
    document.getElementById('actions-area').innerHTML = '';
    document.getElementById('resolution-area').innerHTML = '';
    document.getElementById('history-log').innerHTML = '';
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
    gStats = { hands: 0, correct: 0, incorrect: 0, survived: 0, died: 0, doubleDied: 0 };
    gHistory = [];
    if (gMode === 'mp-host') mpSend({ type: 'new_session' });
    renderHistory();
    newHand();
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
