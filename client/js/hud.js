// All DOM: HUD, feed, chat, role card, scoreboard, results, lobby.
// Deliberately sparse in game - health, ammo, cooldown, one objective line.
// Roles are never on screen unless somebody has died or you asked to see yours.

import {
  CHARACTERS, CHARACTER_ORDER, ROLES, VOICE_LINES, WEAPONS, PHASE, CARDS, CARD_ORDER,
} from '../../shared/constants.js';
import { useDefs, cardUrl } from './cardart.js';

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
        <h4>${c.role.toUpperCase()}</h4>
        <div class="who">${c.name}</div>
        <div class="ab">${c.ability}</div>
        <p>${c.desc}</p>`;
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
    strip.innerHTML = CARD_ORDER.map((id) => {
      const c = CARDS[id];
      return `<figure class="deckCard" data-id="${id}" title="${escapeHtml(c.desc)}">
        <span class="deckSlot"></span>
        <figcaption>${escapeHtml(c.name)}</figcaption></figure>`;
    }).join('');
    const queue = [...CARD_ORDER];
    const next = () => {
      const id = queue.shift();
      if (!id) return;
      const slot = strip.querySelector(`.deckCard[data-id="${id}"] .deckSlot`);
      if (slot) {
        const img = document.createElement('img');
        img.src = cardUrl(id);
        img.alt = CARDS[id].name;
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
      el.style.left = `${210 + Math.cos(a) * 150}px`;
      el.style.top = `${210 + Math.sin(a) * 150}px`;
      el.innerHTML = `<b>${i + 1}</b>${line.text}`;
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
    $('botBreak').textContent = `${humans} human · ${bots} bot${bots === 1 ? '' : 's'}`;

    // A public town deals itself in once a second person turns up. Count it
    // down locally rather than making the server push a packet a second.
    this.autoStartAt = msg.startsIn > 0 ? performance.now() / 1000 + msg.startsIn : 0;
    this.tickAutoStart();
  }

  tickAutoStart() {
    const btn = $('startBtn');
    if (!this.autoStartAt) {
      btn.textContent = 'DEAL THE ROLES';
      btn.classList.remove('counting');
      return;
    }
    const left = Math.max(0, Math.ceil(this.autoStartAt - performance.now() / 1000));
    btn.textContent = left > 0 ? `DEAL THE ROLES — ${left}s` : 'DEALING…';
    btn.classList.add('counting');
  }

  setStatus(text) { $('menuStatus').textContent = text; }

  /** A banner in game, because the menu status line is not on screen there. */
  setReconnecting(on, attempt = 0) {
    const el = $('netBanner');
    el.classList.toggle('hidden', !on);
    if (on) el.textContent = `RECONNECTING${attempt > 1 ? ` (${attempt})` : ''}…`;
  }

  setRoom(msg) {
    $('roomCode').textContent = msg.code || '····';
    const kind = !msg.code ? 'finding a town…'
      : msg.isPublic ? 'public · strangers can drop in'
      : 'private · code only';
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
    $('roleName').textContent = msg.roleName.toUpperCase();
    $('roleName').style.color = msg.color;
    $('roleFaction').textContent = msg.faction === 'law' ? 'THE LAW' : msg.faction === 'outlaw' ? 'THE GANG' : 'NOBODY BUT YOU';
    $('roleBlurb').textContent = msg.blurb;
    $('roleObjective').textContent = msg.objective;
    $('roleIntel').textContent = msg.intel || 'Nothing. You are working blind.';
    $('roleCharacter').textContent = `${c.role} — ${c.name}`;
    $('roleAbility').textContent = `${c.ability}: ${c.desc}`;
    this.setObjective(msg.objective);
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

  // ------------------------------------------------------------- hud state
  setPhase(msg) {
    $('phaseLabel').textContent = PHASE_LABEL[msg.phase] || msg.phase.toUpperCase();
    if (msg.phase === PHASE.PREP) {
      this.setObjective('Guns are holstered. Find weapons, find people, decide who you like.');
    } else if (this.selfRole) {
      this.setObjective(this.selfRole.objective);
    }
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
    $('dynCount').innerHTML = `DYNAMITE x${s.dyn} <em>G</em>`;

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
    if (!this.hand.length && !this.armed.length) { box.innerHTML = ''; return; }
    const keys = ['Z', 'X'];
    const one = (id, key, live) => {
      const c = CARDS[id];
      // How it plays, in one word: arms and waits for a trigger, resolves the
      // moment you press the key, or runs on a clock.
      const kind = c.kind === 'armed' ? 'ARMS UNTIL SPENT'
        : c.kind === 'timed' ? `${c.duration}s` : 'AT ONCE';
      return `<div class="handCard${live ? ' live' : ''}">
        <img src="${cardUrl(id)}" alt="${escapeHtml(c.name)}">
        <div class="handText">
          <h5><span>${escapeHtml(c.name)}</span><em>${live ? 'IN PLAY' : key}</em></h5>
          <div class="handKind">${kind}</div>
          <p>${escapeHtml(c.desc)}</p>
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
    el.querySelector('span').textContent = LOOT_LABEL[item.type] || item.type;
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
    const roleTag = `<span class="rle" style="color:${r.color}">${r.name}</span>`;
    let line;
    if (msg.youDied) {
      line = msg.killerName
        ? `<b>${escapeHtml(msg.killerName)}</b> put you down in ${msg.place}.`
        : `You died in ${msg.place}.`;
    } else if (msg.youKilled) {
      line = `You killed <b>${escapeHtml(msg.victimName)}</b> — they were the ${roleTag}.`;
    } else if (msg.witnessed && msg.killerName) {
      line = `You watch <b>${escapeHtml(msg.killerName)}</b> kill <b>${escapeHtml(msg.victimName)}</b> — the ${roleTag}.`;
    } else if (msg.cause === 'storm') {
      line = `<b>${escapeHtml(msg.victimName)}</b> choked out in the storm — the ${roleTag}.`;
    } else if (msg.cause === 'left') {
      line = `<b>${escapeHtml(msg.victimName)}</b> rode out of town — the ${roleTag}.`;
    } else {
      line = `A shot in ${msg.place}. <b>${escapeHtml(msg.victimName)}</b> is dead — the ${roleTag}. Nobody saw who.`;
    }
    this.addFeed(line, 'kill');
    const p = this.roster.get(msg.victim);
    if (p) p.alive = false;
  }

  addChat(msg) {
    const el = document.createElement('div');
    el.className = 'chatLine' + (msg.voice ? ' voice' : '') + (msg.dead ? ' dead' : '');
    el.innerHTML = `<b>${escapeHtml(msg.from)}${msg.dead ? ' (dead)' : ''}:</b> ${escapeHtml(msg.text)}`;
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
        <td>${escapeHtml(p.name || '?')}${isSelf ? ' <span class="muted">(you)</span>' : ''}</td>
        <td>${p.alive ? 'standing' : 'dead'}</td>
        ${role
          ? `<td class="role" style="color:${role.color}">${role.name}${isSelf ? ' (yours)' : ''}</td>`
          : '<td class="unknown">unknown</td>'}
        <td>${p.alive ? '—' : ''}</td>`;
      tb.appendChild(tr);
    }
  }

  // --------------------------------------------------------------- results
  showResults(msg) {
    $('resultTitle').textContent = msg.title;
    $('resultTitle').className = msg.winner;
    $('resultBlurb').textContent = msg.blurb;
    const tb = $('resultTable').querySelector('tbody');
    tb.innerHTML = '';
    for (const r of msg.rows) {
      const tr = document.createElement('tr');
      tr.className = (r.alive ? '' : 'dead ') + (r.id === this.game.selfId ? 'you' : '');
      tr.innerHTML = `
        <td>${escapeHtml(r.name)}${r.bot ? ' <span class="muted">bot</span>' : ''}</td>
        <td class="role" style="color:${r.color}">${r.roleName}</td>
        <td>${r.characterName || ''}</td>
        <td>${r.kills}</td>
        <td class="cardCol">${(r.cards || []).map((c) => (CARDS[c]
          ? `<img class="crdMini" src="${cardUrl(c)}" title="${escapeHtml(CARDS[c].name)}" alt="${escapeHtml(CARDS[c].name)}">`
          : '')).join('') || '<span class="muted">—</span>'}</td>
        <td>${r.damage}</td>
        <td>${r.won ? '<span class="wonTag">WON</span>' : '<span class="lostTag">lost</span>'}</td>`;
      tb.appendChild(tr);
    }
    this.renderTimeline(msg.timeline || []);
    $('hud').classList.add('resultsUp');
    $('results').classList.remove('hidden');
  }

  /** The round's public account - the bit worth screenshotting. */
  renderTimeline(events) {
    const ol = $('timeline');
    ol.innerHTML = '';
    if (!events.length) {
      ol.innerHTML = '<li><span class="muted">Nobody did anything worth recording.</span></li>';
      return;
    }
    for (const e of events) {
      const li = document.createElement('li');
      const mm = Math.floor(e.at / 60);
      const ss = String(e.at % 60).padStart(2, '0');
      let body;
      if (e.type === 'death') {
        const r = ROLES[e.victimRole];
        const who = `<b>${escapeHtml(e.victim)}</b> <span class="rle" style="color:${r?.color}">${r?.name || ''}</span>`;
        if (e.cause === 'storm') body = `${who} choked out in the storm`;
        else if (e.cause === 'left') body = `${who} rode out`;
        else if (e.killer) {
          const kr = ROLES[e.killerRole];
          body = `<b>${escapeHtml(e.killer)}</b> <span class="rle" style="color:${kr?.color}">${kr?.name || ''}</span> killed ${who} in ${e.place}`;
        } else body = `${who} died in ${e.place}`;
        li.className = 'death';
      } else if (e.type === 'card') {
        // The payoff for every silent card in the round: the aftermath screen
        // is the first and only place the town finds out what was played.
        const name = escapeHtml(e.cardName || e.card);
        const face = CARDS[e.card] ? `<img class="crdMini" src="${cardUrl(e.card)}" alt="">` : '';
        body = e.target
          ? `${face}<b>${escapeHtml(e.who)}</b> played <span class="crd">${name}</span> on <b>${escapeHtml(e.target)}</b>`
          : `${face}<b>${escapeHtml(e.who)}</b> played <span class="crd">${name}</span>${e.secret ? ' — nobody knew' : ''}`;
        li.className = 'card';
      } else if (e.type === 'badge') {
        body = `<b>${escapeHtml(e.who)}</b> pinned on the star`;
        li.className = 'badge';
      } else {
        body = `<b>${escapeHtml(e.who)}</b> called out <b>${escapeHtml(e.target)}</b>`;
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
    $('resultCountdown').textContent = s > 0 ? `next round in ${s}s` : '';
  }

  showVoiceWheel(show) { $('voiceWheel').classList.toggle('hidden', !show); }

  chatInput(show, dead = false) {
    $('chatInputWrap').classList.toggle('hidden', !show);
    // Being dead is not a broadcast licence - say so before they type.
    $('chatInputWrap').firstElementChild.textContent = dead ? 'SAY (ONLY THE DEAD HEAR YOU)' : 'SAY';
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
