// All DOM: HUD, feed, chat, role card, scoreboard, results, lobby.
// Deliberately sparse in game - health, ammo, cooldown, one objective line.
// Roles are never on screen unless somebody has died or you asked to see yours.

import {
  CHARACTERS, CHARACTER_ORDER, ROLES, VOICE_LINES, WEAPONS, PHASE, CARDS, CARD_ORDER,
} from '../../shared/constants.js';
import { useDefs, cardUrl } from './cardart.js';
import { placePhrase, placeParts, ZONES } from '../../shared/map.js';
import { line } from '../../shared/i18n.js';
import { GUNHANDS } from '../../shared/gunhands.js';
import { DUEL_CARDS, DUEL_CARD_ORDER } from '../../shared/deck.js';
import { duelCardUrl } from './duelart.js';

useDefs(CARDS);

const $ = (id) => document.getElementById(id);

const PHASE_LABEL = {
  [PHASE.PREP]: 'PREPARATION',
  [PHASE.COMBAT]: 'THE ROUND',
  [PHASE.ENDGAME]: 'DUST STORM',
  [PHASE.RESULTS]: 'AFTERMATH',
  [PHASE.LOBBY]: 'LOBBY',
};

export class HUD {
  constructor(game) {
    this.game = game;
    this.knownRoles = new Map();     // id -> role, learned only from bodies
    this.roster = new Map();         // id -> {name, bot, alive, kills}
    this.selfRole = null;
    this.matchNumber = null;
    this.standing = null;
    this.autoStartAt = 0;
    this.hand = [];
    this.armed = [];
    this.feedLines = [];
    this.chatLines = [];
    this.buildCharacterGrid();
    this.buildVoiceWheel();
    this.buildDeckStrip();
  }

  // ------------------------------------------------------------------ menu
  /** This string, in the player's language. Shorthand - it is used everywhere. */
  t(key, english, params) { return this.game.tr(key, english, params); }

  /**
   * The language changed. Everything the HTML owns is repainted by the game's
   * own walker; this is the rest - the widgets whose words came out of
   * constants.js and were built by hand.
   */
  relabel() {
    this.buildCharacterGrid();
    this.buildVoiceWheel();
    this.buildDeckStrip();
    if (this.phase) this.setPhase({ phase: this.phase, alive: this.standing, total: this.standingTotal });
    if (this.hand.length || this.armed.length) this.setHand({ hand: this.hand, armed: this.armed });
    if (this.selfRole) this.setRole(this.selfRole);
    if (this.duel) { this.renderRoleCards(); this.setDuel(this.duel); }
    if (this.turn) this.setTurn(this.turn);
    this.buildManualKeys(this.game.duelMode);
    if (this.chamberLeft != null) this.setChamber({ left: this.chamberLeft, ...(this.chamberMix || {}) });
  }

  /**
   * The keys, for the game being played. The two modes disagree about what
   * half the number row does and about whether you can walk, so printing one
   * list for both would be printing a wrong one for each.
   */
  buildManualKeys(duel) {
    const box = $('manKeys');
    if (!box) return;
    const common = [
      ['key.move', 'WASD', 'move'],
      ['key.pickup', 'E', 'pick up'],
      ['key.callout', 'F', 'call out'],
      ['key.shout', 'V', 'shout'],
      ['key.chat', 'T', 'chat'],
      ['key.table', 'Tab', 'table'],
      ['key.hand', 'H', 'your hand'],
      ['key.star', 'B', 'pin the star'],
      ['key.manual', 'F1', 'this page'],
      ['key.settings', 'Esc', 'settings'],
    ];
    // Q is the ability in one game and the barrel turned round in the other,
    // and Space is a jump in one and getting out of the way in the other.
    const duelKeys = [
      ['man.key.fire', 'LMB', 'fire — once the barrel has been on him a moment'],
      ['man.key.cards', '1…9', 'play a card'],
      ['man.key.brace', 'Space', 'get out of the way'],
      ['man.key.self', 'Q', 'turn it on yourself'],
    ];
    const freeKeys = [
      ['key.ability', 'Q', 'ability'],
      ['key.sprint', 'Shift', 'sprint'],
      ['key.crouch', 'Ctrl', 'crouch'],
      ['key.jump', 'Space', 'jump'],
      ['key.fire', 'LMB', 'fire'],
      ['key.aim', 'RMB', 'aim (rifle)'],
      ['key.reload', 'R', 'reload'],
      ['key.guns', '1 2 3', 'guns'],
      ['key.dynamite', 'G', 'dynamite'],
      ['key.card', 'Z X', 'play a card'],
    ];
    const rows = duel ? [...duelKeys, ...common] : [...freeKeys, ...common];
    box.innerHTML = rows.map(([key, cap, what]) => {
      // The cap is a key on a keyboard and does not translate; the word beside
      // it is the whole of what a manual is for and does.
      const said = this.t(key, `<b>${cap}</b> ${what}`);
      return `<span>${said}</span>`;
    }).join('');
  }

  buildCharacterGrid() {
    const grid = $('charGrid');
    grid.innerHTML = '';
    for (const id of CHARACTER_ORDER) {
      const c = CHARACTERS[id];
      const el = document.createElement('div');
      el.className = 'charCard' + (id === this.game.character ? ' sel' : '');
      el.dataset.id = id;
      el.innerHTML = `
        <div class="swatch" style="background:linear-gradient(90deg,${c.coat},${c.accent})"></div>
        <h4>${escapeHtml(this.t(`char.${id}.role`, c.role).toUpperCase())}</h4>
        <div class="who">${escapeHtml(c.name)}</div>
        <div class="ab">${escapeHtml(this.t(`char.${id}.ability`, c.ability))}</div>
        <p>${escapeHtml(this.t(`char.${id}.desc`, c.desc))}</p>`;
      el.onclick = () => {
        this.game.character = id;
        for (const n of grid.children) n.classList.toggle('sel', n.dataset.id === id);
      };
      grid.appendChild(el);
    }
  }

  /**
   * The whole deck, face up, in the lobby. Printing six faces costs about 180ms
   * of canvas, so they go in one per idle slice and the menu never stutters.
   */
  buildDeckStrip() {
    const strip = $('deckStrip');
    if (!strip) return;
    // Whichever deck this town is playing with. Twenty-two plates is a lot of
    // press work, so it is still one card per idle slice - the strip fills in
    // while somebody is picking a gunhand, which is what the lobby is for.
    const duel = !!this.game.duelMode;
    const order = duel ? DUEL_CARD_ORDER : CARD_ORDER;
    const defs = duel ? DUEL_CARDS : CARDS;
    const url = duel ? duelCardUrl : cardUrl;
    // Four whole literal keys rather than two built out of parts, so the suite
    // can still see which keys this file asks for. It reads worse and catches
    // a rename, which is the trade every key in this project makes.
    const name = (id, english) => (duel
      ? this.t(`duel.${id}.name`, english) : this.t(`card.${id}.name`, english));
    const rulesOf = (id, english) => (duel
      ? this.t(`duel.${id}.rules`, english) : this.t(`card.${id}.rules`, english));
    strip.classList.toggle('eighty', duel);
    strip.innerHTML = order.map((id) => {
      const c = defs[id];
      const rules = rulesOf(id, c.rules || c.desc);
      return `<figure class="deckCard" data-id="${id}" title="${escapeHtml(rules)}">
        <span class="deckSlot"></span>
        <figcaption>${escapeHtml(name(id, c.name))}
          <em>${escapeHtml(rules)}</em></figcaption></figure>`;
    }).join('');
    // A run of the press, so the one before it stops. The strip is built once
    // at boot out of whichever deck the client guessed and again when the
    // server says which town this is - and the old run's idle queue was still
    // dropping faces into the new strip, which the two decks sharing the id
    // "barrel" made visible: the turn mode's lobby printed a Rain Barrel.
    this.deckRun = (this.deckRun || 0) + 1;
    const run = this.deckRun;
    const queue = [...order];
    const next = () => {
      if (run !== this.deckRun) return;
      const id = queue.shift();
      if (!id) return;
      const slot = strip.querySelector(`.deckCard[data-id="${id}"] .deckSlot`);
      if (slot) {
        const img = document.createElement('img');
        img.src = url(id);
        img.alt = defs[id].name;
        slot.replaceWith(img);
      }
      if (typeof requestIdleCallback === 'function') requestIdleCallback(next, { timeout: 900 });
      else setTimeout(next, 40);
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(next, { timeout: 1500 });
    else setTimeout(next, 300);
  }

  buildVoiceWheel() {
    const inner = $('voiceInner');
    inner.innerHTML = '';
    VOICE_LINES.forEach((line, i) => {
      const a = (i / VOICE_LINES.length) * Math.PI * 2 - Math.PI / 2;
      const el = document.createElement('div');
      el.className = 'voiceOpt';
      // Wider than it is tall: the tiles are wide and the ones that end up at
      // the top and bottom of the ring are the ones that collide.
      el.style.left = `${350 + Math.cos(a) * 250}px`;
      el.style.top = `${215 + Math.sin(a) * 175}px`;
      el.innerHTML = `<b>${i + 1}</b>${escapeHtml(this.t(`voice.${line.id}`, line.text))}`;
      inner.appendChild(el);
    });
  }

  setLobby(msg) {
    const ul = $('lobbyList');
    ul.innerHTML = '';
    for (const p of msg.players) {
      // Seed the scoreboard here: with visibility culling the snapshots only
      // carry people you can see, but you still need to be able to name and
      // accuse everyone in the round.
      const cur = this.roster.get(p.id) || { alive: true };
      this.roster.set(p.id, { ...cur, name: p.name, character: p.character, bot: p.bot });
      const li = document.createElement('li');
      const c = CHARACTERS[p.character];
      li.innerHTML = `<b>${escapeHtml(p.name)}</b><span>${c ? c.role : ''}${p.bot ? ' · bot' : ''}</span>`;
      void 0;
      ul.appendChild(li);
    }
    if (!msg.players.length) ul.innerHTML = '<li><span>nobody yet</span></li>';
    $('botCount').textContent = msg.botTarget;
    const humans = msg.players.filter((p) => !p.bot).length;
    const bots = Math.max(0, msg.botTarget - humans);
    $('botBreak').textContent = this.t('ui.humanBots',
      `${humans} human · ${bots} bot${bots === 1 ? '' : 's'}`, { h: humans, b: bots });

    // A public town deals itself in once a second person turns up. Count it
    // down locally rather than making the server push a packet a second.
    this.autoStartAt = msg.startsIn > 0 ? performance.now() / 1000 + msg.startsIn : 0;
    this.tickAutoStart();
  }

  tickAutoStart() {
    const btn = $('startBtn');
    if (!this.autoStartAt) {
      btn.textContent = this.t('ui.deal', 'DEAL THE ROLES');
      btn.classList.remove('counting');
      return;
    }
    const left = Math.max(0, Math.ceil(this.autoStartAt - performance.now() / 1000));
    btn.textContent = left > 0
      ? this.t('ui.dealIn', `DEAL THE ROLES — ${left}s`, { n: left })
      : this.t('ui.dealing', 'DEALING…');
    btn.classList.add('counting');
  }

  setStatus(text) { $('menuStatus').textContent = text; }

  /** A banner in game, because the menu status line is not on screen there. */
  setReconnecting(on, attempt = 0) {
    const el = $('netBanner');
    el.classList.toggle('hidden', !on);
    if (on) {
      el.textContent = attempt > 1
        ? this.t('hud.reconnectingN', `RECONNECTING (${attempt})…`, { n: attempt })
        : this.t('hud.reconnecting', 'RECONNECTING…');
    }
    // Every one of these buttons is a message to a server that is not there.
    // The status line says why; a button that still looks pressable does not.
    // Nothing else in the client sets `disabled` on any of them, so this can
    // own the flag outright.
    for (const id of ['startBtn', 'joinBtn', 'newRoom', 'botPlus', 'botMinus']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = on;
    }
  }

  setRoom(msg) {
    $('roomCode').textContent = msg.code || '····';
    const kind = !msg.code ? this.t('ui.findingTown', 'finding a town…')
      : msg.isPublic ? this.t('ui.publicTown', 'public · strangers can drop in')
        : this.t('ui.privateTown', 'private · code only');
    $('roomKind').textContent = kind;
    $('copyLink').disabled = !msg.code;
  }

  showMenu(show) {
    $('menu').classList.toggle('hidden', !show);
    $('hud').classList.toggle('hidden', show);
  }

  // ------------------------------------------------------------- role card
  /** Take a role, without necessarily putting the card in front of anybody. */
  setRole(msg) {
    // A reconnect mid-round carries the same match number, and everything this
    // player has worked out about the dead stays worked out.
    if (msg.match !== this.matchNumber) {
      this.newMatch();
      this.matchNumber = msg.match;
    }
    this.selfRole = msg;
    const c = CHARACTERS[msg.character];
    // The server sends the English. The role's own id is the key to the rest.
    const role = msg.role;
    const objective = this.t(`role.${role}.objective`, msg.objective);
    $('roleName').textContent = this.t(`role.${role}.name`, msg.roleName).toUpperCase();
    $('roleName').style.color = msg.color;
    $('roleFaction').textContent = msg.faction === 'law'
      ? this.t('faction.law', 'THE LAW')
      : msg.faction === 'outlaw' ? this.t('faction.outlaw', 'THE GANG')
        : this.t('faction.renegade', 'NOBODY BUT YOU');
    $('roleBlurb').textContent = this.t(`role.${role}.blurb`, msg.blurb);
    $('roleObjective').textContent = objective;
    $('roleIntel').textContent = msg.intelK
      ? this.t(msg.intelK, msg.intel, msg.intelP)
      : (msg.intel || this.t('role.blind', 'Nothing. You are working blind.'));
    // Two games, two sets of gunhands. The six in constants.js are abilities
    // for a game where you shoot when you like; the sixteen are for one where
    // the only question is whose go it is, and they have nothing to say to
    // each other - so whichever the server dealt is the one shown.
    const g = msg.gunhand ? GUNHANDS[msg.gunhand] : null;
    const label = $('charLabel');
    if (g) {
      // Not a person: a thing about the person you already are. The label
      // above it says so, or the card reads as somebody else's name card.
      if (label) {
        label.setAttribute('data-i18n', 'role.yourHands');
        label.hnhEnglish = { 'data-i18n': 'WHAT YOUR HANDS DO' };
        label.textContent = this.t('role.yourHands', 'WHAT YOUR HANDS DO');
      }
      $('roleCharacter').textContent = this.t(`gun.${g.id}.ability`, g.ability);
      $('roleAbility').textContent = this.t(`gun.${g.id}.desc`, g.desc);
    } else {
      if (label) {
        label.setAttribute('data-i18n', 'role.youArePlaying');
        label.hnhEnglish = { 'data-i18n': 'YOU ARE PLAYING' };
        label.textContent = this.t('role.youArePlaying', 'YOU ARE PLAYING');
      }
      $('roleCharacter').textContent = `${this.t(`char.${msg.character}.role`, c.role)} — ${c.name}`;
      $('roleAbility').textContent = `${this.t(`char.${msg.character}.ability`, c.ability)}: `
        + this.t(`char.${msg.character}.desc`, c.desc);
    }
    this.setObjective(objective);
  }

  showRoleCard(msg) {
    this.setRole(msg);
    $('roleCard').classList.remove('hidden');
  }

  peekRole(show) {
    if (!this.selfRole) return;
    $('roleCard').classList.toggle('hidden', !show);
  }

  setObjective(text) { $('objective').textContent = text; }

  // -------------------------------------------------------------- the turn
  /**
   * Whose go it is. A card game round a table says this by whose hands are
   * moving; here everybody is moving at once, so it has to be said out loud.
   */
  setTurn(msg) {
    this.turn = msg && msg.kind ? msg : null;
    const bar = $('turnBar');
    if (!this.turn) {
      bar.classList.add('hidden');
      $('hud').classList.remove('rooted');
      return;
    }
    const mine = this.turn.holder === this.game.selfId;
    const walk = this.turn.kind === 'reposition';
    bar.classList.remove('hidden');
    bar.classList.toggle('mine', mine && !walk);
    bar.classList.toggle('walk', walk);
    $('hud').classList.toggle('rooted', !walk);

    $('turnWhat').textContent = walk
      ? this.t('turn.walk', 'FIND YOUR MARK')
      : mine ? this.t('turn.yours', 'YOUR GO')
        : this.t('turn.theirs', `${this.nameOf(this.turn.holder)} HAS THE FLOOR`,
          { name: this.nameOf(this.turn.holder) });
    $('turnClock').textContent = walk
      ? this.t('turn.walkHint', 'nobody can shoot · everybody can walk')
      : this.t('turn.rootedHint', 'nobody can walk');

    const ol = $('turnOrder');
    ol.innerHTML = '';
    for (const id of this.turn.order || []) {
      const li = document.createElement('li');
      li.textContent = this.nameOf(id);
      li.className = (id === this.turn.holder ? 'now ' : '')
        + (id === this.game.selfId ? 'self' : '');
      ol.appendChild(li);
    }
    this.tickTurnClock();
  }

  /** The seconds left, ticked locally so the server sends one packet, not thirty. */
  tickTurnClock() {
    if (!this.turn) return;
    const left = Math.max(0, (this.game.turnDeadline || 0) - performance.now() / 1000);
    const el = $('turnClock');
    const label = this.turn.kind === 'reposition'
      ? this.t('turn.walkHint', 'nobody can shoot · everybody can walk')
      : this.t('turn.rootedHint', 'nobody can walk');
    el.textContent = `${label} · ${left.toFixed(1)}s`;
  }

  nameOf(id) { return this.roster.get(id)?.name || '?'; }

  /**
   * A place, as it reads after a verb. English already has one of these in
   * map.js; this is the same sentence built the other way round for a language
   * that puts the preposition on the end - "in the Saloon", "살룬에서".
   */
  place(raw) {
    const english = placePhrase(raw);
    const parts = placeParts(raw);
    if (!parts) return english;
    const zone = (id) => this.t(`place.${id}`, ZONES.find((z) => z.id === id)?.name || id);
    if (parts.kind === 'outskirts') return this.t('place.outskirts', english);
    const here = zone(parts.ids[0]);
    if (parts.kind === 'between') {
      return this.t('place.between', english,
        { a: here, b: this.t('place.flats', 'the flats') });
    }
    return this.t(`place.${parts.kind}`, english, { p: here });
  }

  // ------------------------------------------------------------ the chamber
  /** How many rounds are left in the chamber the whole town is counting. */
  setChamber(msg) {
    if (msg.live != null) this.chamberMix = { live: msg.live, blank: msg.blank };
    this.chamberLeft = msg.left;
    const bar = $('chamberBar');
    if (this.chamberLeft == null) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    $('chamberLeft').textContent = this.t('cham.left', `${this.chamberLeft} IN THE CHAMBER`,
      { n: this.chamberLeft });
    $('chamberMix').textContent = this.chamberMix
      ? this.t('cham.mix', `loaded ${this.chamberMix.live} live, ${this.chamberMix.blank} blank`,
        { live: this.chamberMix.live, blank: this.chamberMix.blank })
      : '';
  }

  /** Somebody's barrel has stopped on you, and you have a moment to move. */
  setAimed(msg) {
    const el = $('aimedWarn');
    if (!msg.on) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const held = (this.duel?.hand || []).includes('missed');
    el.innerHTML = `${escapeHtml(this.t('aim.onYou', 'HE HAS YOU'))}`
      + `<b>${escapeHtml(held
        ? this.t('aim.brace', 'SPACE — move, and spend the card')
        : this.t('aim.nothing', 'and you have nothing to answer with'))}</b>`;
  }

  // --------------------------------------------------------------- the hand
  /**
   * The eighty-card hand. Text for now rather than printed faces - the press
   * in cardart.js knows six cards and these are twenty-two others.
   */
  setDuel(msg) {
    const first = !this.duel;
    this.duel = msg;
    // The role card is on screen when the first hand lands; it was drawn
    // before the deal reached us, so draw it again now there is something in it.
    if (first) this.renderRoleCards();
    const hand = $('duelHand');
    const yours = this.game.turn && this.game.turn.holder === this.game.selfId;
    hand.classList.toggle('hidden', !msg.hand.length);
    hand.innerHTML = msg.hand.map((id, i) => {
      const c = DUEL_CARDS[id];
      if (!c) return '';
      // Greyed when it cannot be played: not your go, or it is the card you
      // fire with rather than press a key for.
      const dead = !yours || c.kind === 'shot' || c.kind === 'reaction';
      return `<div class="dCard ${c.kind}${dead ? ' cannot' : ''}">
        <b><span>${escapeHtml(this.t(`duel.${id}.name`, c.name))}</span><i>${i + 1}</i></b>
        <p>${escapeHtml(this.t(`duel.${id}.rules`, c.rules))}</p>
        ${c.kind === 'target' || c.kind === 'curse'
          ? `<em>${escapeHtml(this.t('duel.aimFirst', 'aim at somebody first'))}</em>` : ''}
      </div>`;
    }).join('');

    const gear = $('duelGear');
    const mine = [...(msg.gear || [])];
    if (msg.weapon) mine.unshift(msg.weapon);
    gear.classList.toggle('hidden', !mine.length);
    gear.innerHTML = mine.map((id) => {
      const c = DUEL_CARDS[id];
      return `<span>${escapeHtml(this.t(`duel.${id}.name`, c?.name || id))}</span>`;
    }).join('');
  }

  // ------------------------------------------------------------- hud state
  setPhase(msg) {
    this.phase = msg.phase;
    $('phaseLabel').textContent = this.t(`phase.${msg.phase}`,
      PHASE_LABEL[msg.phase] || msg.phase.toUpperCase());
    this.setStanding(msg.alive, msg.total);
    if (msg.phase === PHASE.PREP) {
      this.setObjective(this.t('phase.prepObjective',
        'Guns are holstered. Find weapons, find people, decide who you like.'));
    } else if (this.selfRole) {
      this.setObjective(this.t(`role.${this.selfRole.role}.objective`, this.selfRole.objective));
    }
  }

  /** The one number a hidden-role round turns on. */
  setStanding(n, total) {
    if (!Number.isFinite(n)) return;
    const el = $('standing');
    if (this.standing != null && n < this.standing) {
      el.classList.remove('dropped');
      void el.offsetWidth;
      el.classList.add('dropped');
    }
    this.standing = n;
    this.standingTotal = total;
    el.innerHTML = this.t('hud.standing', `<b>${n}</b> STILL STANDING`, { n })
      + (Number.isFinite(total) && total > n
        ? ` <span class="muted">${this.t('hud.ofTotal', `of ${total}`, { n: total })}</span>` : '');
  }

  setTimer(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    $('timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('timer').classList.toggle('urgent', seconds <= 30);
  }

  setSelf(s) {
    const pct = Math.max(0, Math.min(1, s.hp / s.maxHp));
    $('healthFill').style.transform = `scaleX(${pct})`;
    $('healthNum').textContent = s.hp;
    $('healthWrap').classList.toggle('low', pct < 0.34);
    $('armourFill').style.width = `${Math.min(100, (s.armour / 45) * 100)}%`;
    $('armourFill').style.display = s.armour > 0 ? 'block' : 'none';

    // The sprint bar only exists while you are spending it. A permanent second
    // bar under the health would say "manage this", and it is not that kind of
    // resource - it is a reason you cannot outrun the man behind you forever.
    const stam = Number.isFinite(s.stam) ? s.stam : (s.stamMax || 5);
    const stamMax = s.stamMax || 5;
    const stamPct = Math.max(0, Math.min(1, stam / stamMax));
    $('staminaBar').classList.toggle('spent', stamPct >= 0.999);
    $('staminaBar').classList.toggle('empty', stam <= 0.02);
    $('staminaFill').style.transform = `scaleX(${stamPct})`;

    const w = WEAPONS[s.weapon];
    $('weaponName').textContent = w ? w.short : '';
    $('mag').textContent = s.mag;
    $('reserve').textContent = `/ ${s.reserve}`;
    $('ammo').classList.toggle('empty', s.mag === 0);
    $('dynCount').classList.toggle('hidden', s.dyn <= 0);
    $('dynCount').innerHTML = `${escapeHtml(this.t('hud.dynamite', `DYNAMITE x${s.dyn}`, { n: s.dyn }))} <em>G</em>`;

    const c = CHARACTERS[this.game.character];
    const cdPct = s.cd > 0 ? 1 - s.cd / (s.cdMax || 1) : 1;
    $('cdRing').querySelector('.fg').style.strokeDashoffset = String(126 * (1 - cdPct));
    $('abilityName').textContent = c.ability.toUpperCase();
    $('abilityWrap').classList.toggle('ready', s.cd <= 0);
    $('abilityWrap').classList.toggle('active', s.active > 0);

    const bar = $('reloadBar');
    if (s.reloading > 0) {
      bar.classList.remove('hidden');
      bar.firstElementChild.style.width = `${Math.max(0, Math.min(100, (1 - s.reloading / (w?.reloadTime || 2)) * 100))}%`;
    } else bar.classList.add('hidden');

    const chips = [];
    if (s.badge) chips.push(['THE STAR IS ON', 'badge']);
    for (const b of s.buffs || []) {
      if (b === 'speedMult') chips.push(['FLEET FOOTED', '']);
      else if (b === 'damageMult') chips.push(['HOT STREAK', '']);
      else if (b === 'spreadMult') chips.push(['CALLED SHOT', '']);
      else if (b === 'fireRateMult') chips.push(['HAIR TRIGGER', '']);
      else if (b === 'dust') chips.push(['DUST DEVIL', '']);
      else if (b === 'resist') chips.push(['IRON PLATE', '']);
    }
    $('statusStrip').innerHTML = chips.map(([t, cls]) => `<div class="statusChip ${cls}">${t}</div>`).join('');
    $('dustOverlay').style.opacity = (s.buffs || []).includes('dust') ? '1' : '0';
  }

  // ------------------------------------------------------------------ cards
  /**
   * Your hand, and only ever your hand. The faces are printed once by cardart.js
   * and then reused as data URLs, so fanning six of them costs nothing.
   */
  setHand(msg) {
    const prev = this.hand;
    this.hand = msg.hand || [];
    this.armed = msg.armed || [];
    // A brand new hand arrives while the role card is still covering the screen,
    // so it is dealt face down and held until the player takes the reins.
    const fresh = (!prev || !prev.length) && this.hand.length > 0;
    // Only a fresh deal is laid out face down. Anything else - a card played,
    // a card armed - redraws face up, and cancels a deal that never got shown.
    this.pendingDeal = fresh;

    const el = $('handStrip');
    const keys = ['Z', 'X'];
    if (fresh) el.classList.remove('dealt');
    el.innerHTML = '';
    this.hand.forEach((id, i) => {
      const c = CARDS[id];
      const face = cardUrl(id);
      const d = document.createElement('div');
      d.className = 'cardChip';
      d.title = `${c.name} — ${c.desc}`;
      d.style.setProperty('--i', String(i));
      d.style.setProperty('--n', String(this.hand.length));
      d.innerHTML = `<div class="flip"><img src="${fresh ? cardUrl('back') : face}"
        alt="${escapeHtml(fresh ? 'face down' : c.name)}"></div><b>${keys[i] || ''}</b>`;
      d.querySelector('img').dataset.face = face;
      d.dataset.name = c.name;
      el.appendChild(d);
    });
    for (const id of this.armed) {
      const c = CARDS[id];
      const d = document.createElement('div');
      d.className = 'cardChip live';
      d.title = `${c.name} — in play. ${c.desc}`;
      d.innerHTML = `<div class="flip"><img src="${cardUrl(id)}" alt="${escapeHtml(c.name)}"></div>`
        + `<b>●</b><i>IN PLAY</i>`;
      el.appendChild(d);
    }

    // Whatever left the hand since last time is what was just played.
    if (prev && prev.length > this.hand.length) {
      const gone = prev.find((id) => !this.hand.includes(id));
      if (gone) this.flourish(gone);
    }
    this.renderRoleCards();
  }

  /** Turn the new hand face up. Called once the role card is out of the way. */
  playDealAnimation() {
    if (!this.pendingDeal || !this.hand.length) return;
    this.pendingDeal = false;
    const el = $('handStrip');
    el.classList.remove('dealt');
    void el.offsetWidth;
    el.classList.add('dealt');
    this.game.audio?.cardDeal(this.hand.length);
    // Turn each card over at the halfway point of its own flip. Swapping the
    // source beats backface-visibility here: the drop shadow on the image
    // flattens the 3D context and the back never gets shown.
    el.querySelectorAll('.cardChip img').forEach((img, i) => {
      const at = 340 + i * 140 + 275;
      setTimeout(() => {
        if (!img.dataset.face) return;
        img.src = img.dataset.face;
        img.alt = img.closest('.cardChip')?.dataset.name || '';
      }, at);
    });
  }

  /** The card you just played, held up long enough to be read, then flicked away. */
  flourish(id) {
    this.lastFlourish = id;          // read by the browser suite, which cannot
                                     // reliably catch a 1.7s animation mid-flight
    const box = $('cardPlay');
    const c = CARDS[id];
    box.innerHTML = `<img src="${cardUrl(id)}" alt="${escapeHtml(c.name)}">`;
    box.classList.remove('hidden', 'go');
    void box.offsetWidth;
    box.classList.add('go');
    this.game.audio?.cardFlick();
    clearTimeout(this._flourish);
    this._flourish = setTimeout(() => box.classList.add('hidden'), 1750);
  }

  renderRoleCards() {
    const box = $('roleCards');
    if (!box) return;
    // The turn mode deals from the eighty instead, and the role card is the
    // one moment before the bell where there is time to read what you drew.
    if (this.duel && this.duel.hand?.length) {
      // Different cards, different keys: the eighty are played off the number
      // row, and the line above the list has to say so or it is a lie.
      const label = $('dealtLabel');
      const english = 'DEALT TO YOU — the <b>number keys</b> to play';
      if (label) {
        // Handed to the language walker rather than painted over the top of it,
        // so switching to Korean afterwards picks up this line and not the one
        // about Z and X that the markup shipped with.
        label.setAttribute('data-i18n-html', 'role.dealtDuel');
        label.hnhEnglish = { 'data-i18n-html': english };
        label.innerHTML = this.t('role.dealtDuel', english);
      }
      box.innerHTML = this.duel.hand.map((id, i) => {
        const c = DUEL_CARDS[id];
        if (!c) return '';
        // The role card is the one quiet moment there is time to look at a
        // face, so this is where the plate goes rather than the HUD, where a
        // hundred-pixel card is a smudge and the words are the whole point.
        return `<div class="handCard duelHandCard">
          <img src="${duelCardUrl(id)}" alt="${escapeHtml(c.name)}">
          <div class="handText">
            <h5><span>${escapeHtml(this.t(`duel.${id}.name`, c.name))}</span><em>${i + 1}</em></h5>
            <div class="handKind">${escapeHtml(this.t(`duel.kind.${c.kind}`, c.kind.toUpperCase()))}</div>
            <p>${escapeHtml(this.t(`duel.${id}.rules`, c.rules))}</p>
          </div></div>`;
      }).join('');
      return;
    }
    if (!this.hand.length && !this.armed.length) { box.innerHTML = ''; return; }
    const keys = ['Z', 'X'];
    const one = (id, key, live) => {
      const c = CARDS[id];
      // How it plays, in one word: arms and waits for a trigger, resolves the
      // moment you press the key, or runs on a clock.
      const kind = c.kind === 'armed' ? this.t('card.kind.armed', 'ARMS UNTIL SPENT')
        : c.kind === 'timed' ? `${c.duration}s` : this.t('card.kind.instant', 'AT ONCE');
      const name = this.t(`card.${id}.name`, c.name);
      return `<div class="handCard${live ? ' live' : ''}">
        <img src="${cardUrl(id)}" alt="${escapeHtml(name)}">
        <div class="handText">
          <h5><span>${escapeHtml(name)}</span><em>${live ? this.t('card.inPlay', 'IN PLAY') : key}</em></h5>
          <div class="handKind">${escapeHtml(kind)}</div>
          <p>${escapeHtml(this.t(`card.${id}.desc`, c.desc))}</p>
        </div></div>`;
    };
    box.innerHTML = this.hand.map((id, i) => one(id, keys[i] || '', false)).join('')
      + this.armed.map((id) => one(id, '', true)).join('');
  }

  showKillcam(msg) {
    $('kcKiller').textContent = msg.killerName;
    $('kcWhere').textContent = msg.place ? `— ${msg.place}` : '';
    $('kcFill').style.width = '0%';
    $('killcam').classList.remove('hidden');
    $('deadBanner').classList.add('hidden');
    $('hud').classList.add('replay');
  }

  killcamProgress(k) { $('kcFill').style.width = `${Math.round(k * 100)}%`; }

  hideKillcam() {
    $('killcam').classList.add('hidden');
    $('hud').classList.remove('replay');
    if (!this.game.self.alive && this.game.inGame) $('deadBanner').classList.remove('hidden');
  }

  setDead(dead) {
    $('deadBanner').classList.toggle('hidden', !dead);
    $('crosshair').classList.toggle('hide', dead);
    // A hand you cannot play should not look playable, and neither should an
    // ammunition count for a gun you are no longer holding.
    $('handStrip').classList.toggle('spent', dead);
    $('hud').classList.toggle('dead', dead);
  }

  setCrosshairSpread(px) {
    $('crosshair').style.setProperty('--spread', `${px}px`);
  }

  hitmarker(kill) {
    const el = $('hitmarker');
    el.classList.remove('show');
    el.classList.toggle('kill', !!kill);
    void el.offsetWidth;
    el.classList.add('show');
  }

  flashDamage(hp, maxHp) {
    $('vignette').style.opacity = String(Math.min(0.95, 1 - hp / maxHp + 0.15));
    clearTimeout(this._vig);
    this._vig = setTimeout(() => {
      $('vignette').style.opacity = String(Math.max(0, (1 - hp / maxHp) * 0.55));
    }, 260);
  }

  damageArrow(angleDeg) {
    const el = document.createElement('div');
    el.className = 'dmgArrow';
    el.style.transform = `rotate(${angleDeg}deg)`;
    $('damageDirs').appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  interact(item) {
    const el = $('interactPrompt');
    if (!item) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('span').textContent = this.t(`loot.${item.type}`, LOOT_LABEL[item.type] || item.type);
  }

  // ------------------------------------------------------------------ feed
  addFeed(html, tone = '') {
    const el = document.createElement('div');
    el.className = `feedLine ${tone}`;
    el.innerHTML = html;
    $('feed').appendChild(el);
    this.feedLines.push(el);
    while (this.feedLines.length > 7) this.feedLines.shift().remove();
    setTimeout(() => el.classList.add('fade'), 11000);
    setTimeout(() => { el.remove(); this.feedLines = this.feedLines.filter((x) => x !== el); }, 12000);
  }

  /**
   * The kill feed is the single most important information channel in the game,
   * so it says exactly as much as the server decided this player is entitled to
   * and not one word more.
   */
  killFeed(msg) {
    this.knownRoles.set(msg.victim, msg.victimRole);
    const r = ROLES[msg.victimRole];
    const role = `<span class="rle" style="color:${r.color}">${escapeHtml(this.t(`role.${msg.victimRole}.name`, r.name))}</span>`;
    const killer = `<b>${escapeHtml(msg.killerName || '')}</b>`;
    const victim = `<b>${escapeHtml(msg.victimName)}</b>`;
    const where = this.place(msg.place);
    let line;
    if (msg.youDied) {
      line = msg.killerName
        ? this.t('kill.youDiedTo', `${killer} put you down ${where}.`, { killer, where })
        : this.t('kill.youDied', `You died ${where}.`, { where });
    } else if (msg.youKilled) {
      line = this.t('kill.youKilled', `You killed ${victim} — they were the ${role}.`, { victim, role });
    } else if (msg.witnessed && msg.killerName) {
      line = this.t('kill.watched', `You watch ${killer} kill ${victim} — the ${role}.`,
        { killer, victim, role });
    } else if (msg.cause === 'storm') {
      line = this.t('kill.storm', `${victim} choked out in the storm — the ${role}.`, { victim, role });
    } else if (msg.cause === 'left') {
      line = this.t('kill.left', `${victim} rode out of town — the ${role}.`, { victim, role });
    } else {
      line = this.t('kill.unseen',
        `A shot ${where}. ${victim} is dead — the ${role}. Nobody saw who.`,
        { where, victim, role });
    }
    this.addFeed(line, 'kill');
    const p = this.roster.get(msg.victim);
    if (p) p.alive = false;
  }

  addChat(msg) {
    const el = document.createElement('div');
    el.className = 'chatLine' + (msg.voice ? ' voice' : '') + (msg.dead ? ' dead' : '');
    // A bot's line and a shout carry a key; anything a person typed does not,
    // and is shown exactly as they typed it.
    const said = line(this.game.settings?.get('lang') || 'en', msg);
    const dead = msg.dead ? ` ${this.t('hud.deadTag', '(dead)')}` : '';
    el.innerHTML = `<b>${escapeHtml(msg.from)}${dead}:</b> ${escapeHtml(said)}`;
    $('chatLog').appendChild(el);
    this.chatLines.push(el);
    while (this.chatLines.length > 9) this.chatLines.shift().remove();
    setTimeout(() => el.classList.add('fade'), 16000);
    setTimeout(() => { el.remove(); this.chatLines = this.chatLines.filter((x) => x !== el); }, 17500);
  }

  // ------------------------------------------------------------ scoreboard
  updateRoster(players) {
    for (const p of players) {
      const cur = this.roster.get(p.id) || {};
      this.roster.set(p.id, {
        name: p.n ?? cur.name,
        alive: !(p.st & 32),
        character: p.ch ?? cur.character,
      });
    }
  }

  toggleScoreboard(show) {
    $('scoreboard').classList.toggle('hidden', !show);
    if (!show) return;
    const tb = $('sbTable').querySelector('tbody');
    tb.innerHTML = '';
    const rows = [...this.roster.entries()];
    rows.sort((a, b) => Number(b[1].alive) - Number(a[1].alive) || a[1].name.localeCompare(b[1].name));
    for (const [id, p] of rows) {
      const isSelf = id === this.game.selfId;
      const known = isSelf ? this.selfRole?.role : this.knownRoles.get(id);
      const role = known ? ROLES[known] : null;
      const tr = document.createElement('tr');
      tr.className = (p.alive ? '' : 'dead ') + (isSelf ? 'you' : '');
      tr.innerHTML = `
        <td>${escapeHtml(p.name || '?')}${isSelf ? ` <span class="muted">${this.t('sb.you', '(you)')}</span>` : ''}</td>
        <td>${p.alive ? this.t('sb.standing', 'standing') : this.t('sb.deadStatus', 'dead')}</td>
        ${role
          ? `<td class="role" style="color:${role.color}">${escapeHtml(this.t(`role.${known}.name`, role.name))}`
            + `${isSelf ? ` ${this.t('sb.yours', '(yours)')}` : ''}</td>`
          : `<td class="unknown">${this.t('sb.unknown', 'unknown')}</td>`}
        <td>${p.alive ? '—' : ''}</td>`;
      tb.appendChild(tr);
    }
  }

  // --------------------------------------------------------------- results
  showResults(msg) {
    $('resultTitle').textContent = this.t(`res.title.${msg.winner}`, msg.title);
    $('resultTitle').className = msg.winner;
    $('resultBlurb').textContent = msg.blurb;
    const tb = $('resultTable').querySelector('tbody');
    tb.innerHTML = '';
    for (const r of msg.rows) {
      const tr = document.createElement('tr');
      tr.className = (r.alive ? '' : 'dead ') + (r.id === this.game.selfId ? 'you' : '');
      tr.innerHTML = `
        <td>${escapeHtml(r.name)}${r.bot ? ` <span class="muted">${this.t('sb.bot', 'bot')}</span>` : ''}</td>
        <td class="role" style="color:${r.color}">${escapeHtml(this.t(`role.${r.role}.name`, r.roleName))}</td>
        <td>${escapeHtml(this.t(`char.${r.character}.role`, r.characterName || ''))}</td>
        <td>${r.kills}</td>
        <td class="cardCol">${(r.cards || []).map((c) => (CARDS[c]
          ? `<img class="crdMini" src="${cardUrl(c)}" title="${escapeHtml(this.t(`card.${c}.name`, CARDS[c].name))}" alt="${escapeHtml(this.t(`card.${c}.name`, CARDS[c].name))}">`
          : '')).join('') || '<span class="muted">—</span>'}</td>
        <td>${r.damage}</td>
        <td>${r.won ? `<span class="wonTag">${this.t('res.won', 'WON')}</span>`
          : `<span class="lostTag">${this.t('res.lost', 'lost')}</span>`}</td>`;
      tb.appendChild(tr);
    }
    this.renderTimeline(msg.timeline || []);
    this.resetReady();
    $('hud').classList.add('resultsUp');
    $('results').classList.remove('hidden');
  }

  /** The round's public account - the bit worth screenshotting. */
  renderTimeline(events) {
    const ol = $('timeline');
    ol.innerHTML = '';
    if (!events.length) {
      ol.innerHTML = `<li><span class="muted">${escapeHtml(
        this.t('tl.nothing', 'Nobody did anything worth recording.'))}</span></li>`;
      return;
    }
    const tag = (role) => {
      const r = ROLES[role];
      if (!r) return '';
      return ` <span class="rle" style="color:${r.color}">${escapeHtml(this.t(`role.${role}.name`, r.name))}</span>`;
    };
    for (const e of events) {
      const li = document.createElement('li');
      const mm = Math.floor(e.at / 60);
      const ss = String(e.at % 60).padStart(2, '0');
      let body;
      if (e.type === 'death') {
        const who = `<b>${escapeHtml(e.victim)}</b>${tag(e.victimRole)}`;
        const where = this.place(e.place);
        if (e.cause === 'storm') body = this.t('tl.storm', `${who} choked out in the storm`, { who });
        else if (e.cause === 'left') body = this.t('tl.left', `${who} rode out`, { who });
        else if (e.killer) {
          const killer = `<b>${escapeHtml(e.killer)}</b>${tag(e.killerRole)}`;
          body = this.t('tl.killed', `${killer} killed ${who} ${where}`, { killer, who, where });
        } else body = this.t('tl.died', `${who} died ${where}`, { who, where });
        li.className = 'death';
      } else if (e.type === 'card') {
        // The payoff for every silent card in the round: the aftermath screen
        // is the first and only place the town finds out what was played.
        const name = `<span class="crd">${escapeHtml(
          this.t(`card.${e.card}.name`, e.cardName || e.card))}</span>`;
        const face = CARDS[e.card] ? `<img class="crdMini" src="${cardUrl(e.card)}" alt="">` : '';
        const who = `<b>${escapeHtml(e.who)}</b>`;
        body = face + (e.target
          ? this.t('tl.cardOn', `${who} played ${name} on <b>${escapeHtml(e.target)}</b>`,
            { who, card: name, target: `<b>${escapeHtml(e.target)}</b>` })
          : this.t(e.secret ? 'tl.cardSecret' : 'tl.card',
            `${who} played ${name}${e.secret ? ' — nobody knew' : ''}`, { who, card: name }));
        li.className = 'card';
      } else if (e.type === 'badge') {
        const who = `<b>${escapeHtml(e.who)}</b>`;
        body = this.t('tl.badge', `${who} pinned on the star`, { who });
        li.className = 'badge';
      } else {
        const who = `<b>${escapeHtml(e.who)}</b>`;
        const target = `<b>${escapeHtml(e.target)}</b>`;
        body = this.t('tl.accuse', `${who} called out ${target}`, { who, target });
        li.className = 'accuse';
      }
      li.innerHTML = `<time>${mm}:${ss}</time>${body}`;
      ol.appendChild(li);
    }
  }

  hideResults() {
    $('results').classList.add('hidden');
    $('hud').classList.remove('resultsUp');
  }

  /** New hand dealt: forget everything we learned about the last round. */
  newMatch() {
    this.knownRoles.clear();
    this.roster.clear();
    this.hand = []; this.armed = [];
    this.pendingDeal = false;
    $('handStrip').innerHTML = '';
    $('handStrip').classList.remove('dealt');
    $('cardPlay').classList.add('hidden');
    const box = $('roleCards');
    if (box) box.innerHTML = '';
  }

  setResultCountdown(s) {
    // What actually happens when this runs out is the lobby, not a new round -
    // a new round needs everybody to say they want one.
    $('resultCountdown').textContent = s > 0
      ? this.t('res.backToLobby', `back to the lobby in ${s}s`, { n: s }) : '';
  }

  /** How many of the living have asked to go again. */
  setReady(msg) {
    const btn = $('playAgain');
    if (!msg || msg.of <= 1) return;
    btn.textContent = this.t('res.rideAgainN', `RIDE AGAIN — ${msg.ready}/${msg.of}`,
      { ready: msg.ready, of: msg.of });
  }

  /** Called when the results screen opens, before anybody has said anything. */
  resetReady() {
    $('playAgain').textContent = this.t('res.rideAgain', 'RIDE AGAIN');
    $('playAgain').disabled = false;
  }

  showVoiceWheel(show) { $('voiceWheel').classList.toggle('hidden', !show); }

  chatInput(show, dead = false) {
    $('chatInputWrap').classList.toggle('hidden', !show);
    // Being dead is not a broadcast licence - say so before they type.
    $('chatInputWrap').firstElementChild.textContent = dead
      ? this.t('hud.sayDead', 'SAY (ONLY THE DEAD HEAR YOU)') : this.t('hud.say', 'SAY');
    if (show) { $('chatInput').value = ''; $('chatInput').focus(); }
    else $('chatInput').blur();
  }
}

const LOOT_LABEL = {
  shotgun: 'take the coach gun',
  rifle: 'take the lever rifle',
  ammo: 'take ammunition',
  whiskey: 'drink (+35 health)',
  dynamite: 'take a stick of dynamite',
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
