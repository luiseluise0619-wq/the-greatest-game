// Client entry point: networking, local movement prediction, input, render loop.
//
// Movement is simulated here and reconciled loosely by the server; shooting is
// only ever *requested* here and resolved there. That split keeps the mouse feel
// tight without letting a client decide who died.

import * as THREE from 'three';
import MAP from '../../shared/map.js';
import { moveAndCollide } from '../../shared/collision.js';
import {
  PLAYER, WEAPONS, BUFF_VALUES, PHASE, VOICE_LINES, ENDGAME, REPLAY, CARD_ORDER, INPUT_RATE, SOCIAL,
  clamp, stepStamina, canSprint, swapTime,
} from '../../shared/constants.js';
import { C, S } from '../../shared/protocol.js';
import { buildWorld, animateWorld } from './world.js';
import { PlayerView } from './players.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { GameAudio } from './audio.js';
import { HUD } from './hud.js';
import { initCharacterModels } from './charmodels.js';
import { cardUrl } from './cardart.js';
import { Settings, LIMITS, motionScale } from './settings.js';

const $ = (id) => document.getElementById(id);
const INTERP_DELAY = 0.1;

class Game {
  constructor() {
    this.character = 'gunslinger';
    this.selfId = null;
    this.phase = PHASE.LOBBY;
    this.phaseLeft = 0;
    this.inGame = false;
    this.views = new Map();
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0 };
    this.sensitivity = 0.0022;
    this.settingsOpen = false;
    this.chatting = false;
    this.voiceOpen = false;

    this.self = {
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      crouch: false, sprint: false, grounded: true, moving: false,
      stamina: PLAYER.staminaMax,
      alive: false, hp: 100, maxHp: 100,
      weapon: 'revolver', mag: 6, reserve: 30, guns: ['revolver'], dyn: 0,
      reloading: 0, swapUntil: 0, nextFireAt: 0, cd: 0, active: 0, badge: false,
      eyeHeight: PLAYER.eye,
    };

    this.ring = 0;
    this.lastFootstep = 0;
    this.wantFire = false;
    this.reloadAskedAt = 0;
    this.ads = false;

    // #ABCD in the URL means "put me in that town". Anything else is quick play.
    this.joinIntent = parseRoomFromUrl();
    this.roomCode = null;

    // Local preferences. The server has no opinion about anybody's sensitivity,
    // so none of this goes on the wire.
    this.settings = new Settings((v) => this.applySettings(v));

    this.hud = new HUD(this);
    this.audio = new GameAudio();
    this.initMenu();
    this.connect();          // socket first: the lobby should answer immediately
    this.initThree();        // then the expensive part
    this.initInput();
    this.initSettingsPanel();
    this.applySettings(this.settings.values);

    this.modelsReady = false;
    modelsLoading.then(() => { this.modelsReady = true; });
  }

  // ---------------------------------------------------------------- three
  initThree() {
    const canvas = $('view');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, 0.06, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.world = null;              // built lazily - see ensureWorld()
    this.effects = new Effects(this.scene);

    // The viewmodel lives in its own scene so it can never clip into a wall.
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 12);
    this.vmScene.add(this.vmCamera);
    // Lit to roughly the same budget as the street outside. It used to carry
    // five and a half units of light between three lamps, which pushed blued
    // steel and walnut past white and handed the player a gun made of chalk.
    this.vmScene.add(new THREE.AmbientLight(0xffe8cc, 0.5));
    const vmKey = new THREE.DirectionalLight(0xfff0d8, 1.7);
    vmKey.position.set(1.4, 1.8, 1.2);       // lights the side the player sees
    this.vmScene.add(vmKey);
    const vmFill = new THREE.DirectionalLight(0xbcd2ee, 0.45);
    vmFill.position.set(-1.2, 0.6, -0.8);
    this.vmScene.add(vmFill);
    this.viewmodel = new ViewModel(this.vmCamera);

    // Muzzle flash that actually lights the room you are standing in.
    this.worldFlash = new THREE.PointLight(0xffbb70, 0, 14, 2);
    this.camera.add(this.worldFlash);

    // Endgame storm wall.
    this.ringMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 60, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xc79a5c, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.ringMesh.position.set(ENDGAME.centre.x, 20, ENDGAME.centre.z);
    this.ringMesh.visible = false;
    this.scene.add(this.ringMesh);

    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.vmCamera.aspect = innerWidth / innerHeight;
      this.vmCamera.updateProjectionMatrix();
    });

    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 600);
  }

  /**
   * Build the town. Deferred out of startup so the lobby is interactive in
   * milliseconds; warmed in the background once connected, and guaranteed
   * before a round begins.
   */
  ensureWorld() {
    if (this.world) return;
    this.world = buildWorld(this.scene);
  }

  warmWorld() {
    if (this.world || this.worldWarming) return;
    this.worldWarming = true;
    const build = () => this.ensureWorld();
    if (typeof requestIdleCallback === 'function') requestIdleCallback(build, { timeout: 2500 });
    else setTimeout(build, 400);
    this.warmDeck();
  }

  /**
   * Print the whole deck while the player is still reading the lobby. Each face
   * is about 30ms of canvas work; doing them one per idle slice means the round
   * never stops to print one - not when a hand is dealt, and not when six of
   * them turn up at once on the results screen.
   */
  warmDeck() {
    if (this.deckWarming) return;
    this.deckWarming = true;
    const queue = [...CARD_ORDER, 'back'];
    const next = () => {
      const id = queue.shift();
      if (!id) return;
      try { cardUrl(id); } catch { /* a blank face is not worth a broken lobby */ }
      if (typeof requestIdleCallback === 'function') requestIdleCallback(next, { timeout: 1200 });
      else setTimeout(next, 60);
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(next, { timeout: 3000 });
    else setTimeout(next, 900);
  }

  // ----------------------------------------------------------------- menu
  initMenu() {
    $('startBtn').onclick = () => {
      this.audio.init();
      this.send({
        t: C.START,
        name: $('nameInput').value.trim() || undefined,
        character: this.character,
      });
    };
    $('copyLink').onclick = () => this.copyInvite();
    $('newRoom').onclick = () => this.switchRoom({ create: true });
    $('joinBtn').onclick = () => {
      const code = $('joinCode').value.trim().toUpperCase();
      if (code.length !== 4) { this.hud.setStatus('a town code is four characters'); return; }
      $('joinCode').value = '';
      this.switchRoom({ room: code });
    };
    $('joinCode').onkeydown = (e) => { if (e.key === 'Enter') $('joinBtn').click(); };

    $('botPlus').onclick = () => this.send({ t: C.ADD_BOT });
    $('botMinus').onclick = () => this.send({ t: C.ADD_BOT, remove: true });
    $('playAgain').onclick = () => {
      // Do not hide the results: with other people in the room this is a
      // readiness call, and the screen has to stay up while we wait for them.
      this.send({ t: C.RESTART });
      $('playAgain').disabled = true;
    };
    // Guarded: a private window or blocked site data throws on access, and a
    // remembered name is not worth losing the menu over.
    try { $('nameInput').value = localStorage.getItem('hnh_name') || ''; } catch { /* fine */ }
    $('nameInput').oninput = () => {
      try { localStorage.setItem('hnh_name', $('nameInput').value); } catch { /* fine */ }
    };
    $('roleCard').onclick = () => this.dismissRoleCard();
  }

  /** Rolling frame rate, sampled once a second so the readout is legible. */
  tickFps(now) {
    this.fpsFrames = (this.fpsFrames || 0) + 1;
    if (!this.fpsSince) { this.fpsSince = now; return; }
    if (now - this.fpsSince < 1) return;
    const fps = Math.round(this.fpsFrames / (now - this.fpsSince));
    $('fpsMeter').textContent = `${fps} fps`;
    this.fpsFrames = 0;
    this.fpsSince = now;
  }

  // ------------------------------------------------------------- settings
  /**
   * Wire the settings panel to the store. Every control writes through
   * Settings.set, which persists and calls applySettings - so there is exactly
   * one path from a control to the running game, and reloading gives the same
   * result as changing it live.
   */
  initSettingsPanel() {
    const v = this.settings.values;
    const range = (el, lim, key, fmt) => {
      el.min = String(lim.min); el.max = String(lim.max); el.step = String(lim.step);
      el.value = String(v[key]);
      el.oninput = () => {
        this.settings.set(key, Number(el.value));
        fmt(this.settings.get(key));
      };
      fmt(v[key]);
    };
    range($('setSens'), LIMITS.sensitivity, 'sensitivity',
      (n) => { $('setSensVal').textContent = n.toFixed(4); });
    range($('setFov'), LIMITS.fov, 'fov',
      (n) => { $('setFovVal').textContent = String(Math.round(n)); });
    range($('setVol'), LIMITS.volume, 'volume',
      (n) => { $('setVolVal').textContent = `${Math.round(n * 100)}%`; });

    const check = (el, key) => {
      el.checked = !!v[key];
      el.onchange = () => this.settings.set(key, el.checked);
    };
    check($('setInvert'), 'invertY');
    check($('setMute'), 'muted');
    check($('setFps'), 'showFps');

    $('setClose').onclick = () => this.showSettings(false);
    $('setReset').onclick = () => { this.settings.reset(); this.syncSettingsPanel(); };
    $('openSettings').onclick = () => this.showSettings(true);
  }

  /** Push the stored values back into the controls, after a reset. */
  syncSettingsPanel() {
    const v = this.settings.values;
    $('setSens').value = String(v.sensitivity);
    $('setSensVal').textContent = v.sensitivity.toFixed(4);
    $('setFov').value = String(v.fov);
    $('setFovVal').textContent = String(v.fov);
    $('setVol').value = String(v.volume);
    $('setVolVal').textContent = `${Math.round(v.volume * 100)}%`;
    $('setInvert').checked = v.invertY;
    $('setMute').checked = v.muted;
    $('setFps').checked = v.showFps;
  }

  applySettings(v) {
    this.sensitivity = v.sensitivity;
    if (this.camera && this.camera.fov !== v.fov) {
      this.camera.fov = v.fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.audio) this.audio.setVolume(v.muted ? 0 : v.volume);
    $('fpsMeter').classList.toggle('hidden', !v.showFps);
  }

  showSettings(show) {
    this.settingsOpen = show;
    $('settings').classList.toggle('hidden', !show);
    if (show) document.exitPointerLock?.();
    else if (this.inGame) this.requestLock();
  }

  async copyInvite() {
    if (!this.roomCode) return;
    const link = `${location.origin}${location.pathname}#${this.roomCode}`;
    const btn = $('copyLink');
    try {
      await navigator.clipboard.writeText(link);
      btn.textContent = 'LINK COPIED';
    } catch {
      // Clipboard is blocked on insecure origins; show the link so it can be
      // selected by hand rather than failing silently.
      btn.textContent = link;
    }
    btn.classList.add('done');
    clearTimeout(this._copyT);
    this._copyT = setTimeout(() => {
      btn.textContent = 'COPY INVITE LINK';
      btn.classList.remove('done');
    }, 2200);
  }

  // -------------------------------------------------------------- network
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => {
      this.retries = 0;
      this.hud.setStatus('connected — pick a gunhand and deal the roles');
      this.hud.setReconnecting(false);
      this.warmWorld();
      this.send({
        t: C.JOIN,
        name: $('nameInput').value.trim() || undefined,
        character: this.character,
        // A refresh in the same tab reclaims the body it left standing in the
        // street. sessionStorage on purpose: a new tab is a new player.
        token: readToken(),
        ...this.joinIntent,
      });
    };
    this.ws.onclose = (e) => {
      if (this.switching) return;               // we closed it on purpose
      if (e && e.code === 4000) return;         // another tab took this seat
      this.scheduleReconnect();
    };
    this.ws.onerror = () => { /* onclose follows and does the work */ };
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this.onMessage(msg);
    };
  }

  /**
   * A dropped socket is usually a blip, and the server keeps your body standing
   * for SOCIAL.reconnectGrace seconds. Retry inside that window, backing off,
   * and let the join token put you back in your own boots. Past it there is
   * nothing to come back to and the honest thing is to say so.
   */
  scheduleReconnect() {
    this.retries = (this.retries || 0) + 1;
    const waits = [0.6, 1.2, 2.5, 5, 9];
    const wait = waits[Math.min(this.retries - 1, waits.length - 1)];
    if (this.retries > waits.length) {
      this.hud.setReconnecting(false);
      this.hud.setStatus('connection lost — refresh to ride again');
      return;
    }
    this.hud.setReconnecting(true, this.retries);
    this.hud.setStatus(`connection lost — reconnecting (${this.retries})…`);
    clearTimeout(this._reconnect);
    this._reconnect = setTimeout(() => this.connect(), wait * 1000);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  /**
   * Move to another town. A socket belongs to exactly one room for its lifetime,
   * so switching means reconnecting - which also gives us a clean slate.
   */
  switchRoom(intent) {
    if (this.inGame) { this.hud.setStatus('finish this round before changing towns'); return; }
    this.joinIntent = intent;
    // A new town means a new body; the old token belongs to the room we left.
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* nothing to do */ }
    this.roomCode = null;
    this.selfId = null;
    this.switching = true;
    if (this.ws) { try { this.ws.close(); } catch { /* already gone */ } }
    this.hud.setStatus('riding over…');
    setTimeout(() => { this.switching = false; this.connect(); }, 120);
  }

  setRoom(msg) {
    this.roomCode = msg.code || null;
    if (this.roomCode) {
      // Keep the address bar shareable: copy it and you have an invite.
      if (location.hash.slice(1).toUpperCase() !== this.roomCode) {
        history.replaceState(null, '', `#${this.roomCode}`);
      }
      this.joinIntent = { room: this.roomCode };
    }
    this.hud.setRoom(msg);
  }

  onMessage(msg) {
    switch (msg.t) {
      case S.WELCOME:
        if (msg.selfId) this.selfId = msg.selfId;
        if (msg.token) writeToken(msg.token);
        this.setRoom(msg);
        break;
      case S.LOBBY: this.hud.setLobby(msg); break;

      case S.ROLE:
        this.selfRole = msg;
        this.character = msg.character;
        if (msg.tp) {
          this.self.pos.set(msg.tp[0], msg.tp[1], msg.tp[2]);
          this.self.vel.set(0, 0, 0);
          this.self.yaw = msg.yaw ?? 0;
          this.self.pitch = 0;
        }
        // Coming back mid-round should not shove the role card in your face
        // while somebody is shooting at you.
        if (msg.resumed) this.hud.setRole(msg);
        else this.hud.showRoleCard(msg);
        break;

      case S.PHASE:
        this.phase = msg.phase;
        this.hud.setPhase(msg);
        if ((msg.phase === PHASE.PREP || msg.phase === PHASE.COMBAT || msg.phase === PHASE.ENDGAME) && !this.inGame) {
          this.enterGame();
        }
        // The bell is the last moment a hand can still be sitting face down:
        // a player who never dismissed the role card gets it turned over now.
        if (msg.phase === PHASE.COMBAT) this.hud.playDealAnimation();
        if (msg.phase === PHASE.RESULTS) this.exitToResults();
        if (msg.phase === PHASE.LOBBY) { this.inGame = false; this.hud.showMenu(true); this.hud.hideResults(); document.exitPointerLock?.(); }
        this.ringMesh.visible = msg.phase === PHASE.ENDGAME;
        break;

      case S.SNAPSHOT: this.onSnapshot(msg); break;

      case S.SELF: this.onSelf(msg); break;

      case S.SHOT: this.onShot(msg); break;

      case S.HIT:
        this.hud.hitmarker(msg.lethal);
        this.audio.hitmarker(msg.lethal);
        break;

      case S.DAMAGE: {
        this.self.hp = msg.hp;
        this.hud.flashDamage(msg.hp, this.self.maxHp);
        this.audio.hurt(msg.amount);
        if (msg.from) {
          const ang = Math.atan2(msg.from[0] - this.self.pos.x, msg.from[2] - this.self.pos.z);
          this.hud.damageArrow(((ang - this.self.yaw) * 180) / Math.PI + 180);
        }
        break;
      }

      case S.KILL:
        this.hud.killFeed(msg);
        if (msg.youDied) this.onSelfDeath();
        break;

      case S.FEED:
        this.hud.addFeed(escapeHtml(msg.text), msg.tone);
        if (msg.deny) this.audio.deny();
        break;
      case S.CHAT:
        this.hud.addChat(msg);
        // A shout has a direction; typed chat does not.
        if (msg.voice) this.audio.shout({ x: msg.x, y: msg.y, z: msg.z }, msg.id === this.selfId);
        break;

      case S.ABILITY: this.onAbilityEvent(msg); break;

      case S.EXPLOSION:
        this.effects.explosion(msg);
        this.audio.explosion(msg);
        break;

      case S.LOOT:
        if (msg.add) {
          for (const it of msg.add) {
            if (!this.effects.lootMeshes.has(it.id)) this.effects.lootMeshes.set(it.id, this.effects.makeLoot(it));
          }
        }
        break;

      case S.PICKED:
        this.effects.removeLoot(msg.id);
        if (msg.by === this.selfId) this.audio.pickup();
        break;

      case S.STEP:
        // Boots somewhere in town. No id on this message by design: you get a
        // direction and a distance, and you work out the rest yourself.
        this.audio.footstepAt({ x: msg.x, y: msg.y, z: msg.z }, !!msg.s, msg.r || 26);
        break;

      case S.FOOTPRINTS:
        this.effects.showFootprints(msg.prints, msg.duration);
        this.hud.addFeed('You read the dust. Fresh prints, no names on them.', 'good');
        break;

      case S.CARDS: this.hud.setHand(msg); break;

      case S.BADGE:
        this.hud.addFeed(`<b>${escapeHtml(msg.name)}</b> pins on the star.`, 'badge');
        this.audio.blip(700, 0.4, 'triangle', 0.16, 1200);
        break;

      case S.CORRECT:
        // The server walked our move through the world and disagreed by enough
        // to matter. It is right; snap.
        this.self.pos.set(msg.pos[0], msg.pos[1], msg.pos[2]);
        this.self.vel.set(0, 0, 0);
        break;

      case S.REPLAY: this.startReplay(msg); break;
      case S.RESULTS: this.endReplay(); this.hud.showResults(msg); break;
      case S.READY: this.hud.setReady(msg); break;
      case S.SOUND: if (msg.sound === 'bell') this.audio.bell(); break;
      case S.ERROR:
        this.hud.setStatus(msg.msg);
        if (msg.fatal) {
          // Bad code: drop back to quick play rather than leaving them stranded.
          history.replaceState(null, '', location.pathname);
          this.joinIntent = {};
          this.hud.setRoom({ code: null });
        }
        break;
    }
  }

  onSnapshot(msg) {
    const now = performance.now() / 1000;
    this.phaseLeft = msg.left;
    this.ring = msg.ring;
    this.hud.updateRoster(msg.ps);
    this.hud.setStanding(msg.aliveCount);

    const seen = new Set();
    for (const p of msg.ps) {
      seen.add(p.id);
      if (p.id === this.selfId) continue;
      let v = this.views.get(p.id);
      if (!v) {
        // Hold off until any configured glTF models have loaded, so nobody gets
        // built as a procedural stand-in and then never upgraded.
        if (!this.modelsReady) continue;
        v = new PlayerView(this.scene, p.id, p.n, p.ch);
        this.views.set(p.id, v);
      }
      v.push(p, now);
    }
    // Anyone missing from the snapshot is simply out of sight - keep the view
    // (their corpse may still be evidence) and stop drawing it. During a killcam
    // the live world stays hidden entirely, or players would wander through the
    // replay.
    for (const [id, v] of this.views) v.setVisible(!this.replay && seen.has(id));

    const revealed = new Set(msg.reveal || []);
    for (const [id, v] of this.views) v.setRevealed(revealed.has(id));

    if (msg.ring > 0) {
      this.ringMesh.scale.set(msg.ring, 1, msg.ring);
      this.ringMesh.visible = true;
    }
  }

  onSelf(msg) {
    const s = this.self;
    if (msg.dead) { s.alive = false; return; }
    const wasWeapon = s.weapon;
    const wasReloading = s.reloading > 0;
    Object.assign(s, {
      hp: msg.hp, maxHp: msg.maxHp, armour: msg.armour,
      weapon: msg.weapon, guns: msg.guns, dyn: msg.dyn,
      cd: msg.cd, cdMax: msg.cdMax, active: msg.active,
      alive: msg.alive, badge: msg.badge, buffs: msg.buffs || [],
    });
    // Trust the server on ammo, but never let a late packet un-fire a shot the
    // player has already seen leave the barrel.
    if (msg.mag <= s.mag || performance.now() / 1000 > s.nextFireAt) s.mag = msg.mag;
    // Stamina is simulated on both sides; only resync when they have genuinely
    // drifted, or every packet would jolt the sprint bar.
    if (Number.isFinite(msg.stam) && Math.abs(msg.stam - s.stamina) > 0.6) s.stamina = msg.stam;
    // The server owns the swap lockout; this is the only place it is told.
    if (Number.isFinite(msg.swap)) {
      s.swapUntil = Math.max(s.swapUntil, performance.now() / 1000 + msg.swap);
    }
    s.reserve = msg.reserve;
    s.reloading = msg.reloading;

    this.lastSelfMsg = msg;
    if (msg.loot) this.effects.syncLoot(msg.loot);
    if (wasWeapon !== msg.weapon) this.viewmodel.setWeapon(msg.weapon);
    if (!wasReloading && msg.reloading > 0) {
      this.viewmodel.startReload(WEAPONS[msg.weapon].reloadTime);
      this.playReloadClicks(WEAPONS[msg.weapon]);
    }
    this.hud.setSelf({ ...msg, hp: s.hp, stam: s.stamina });
    this.hud.setDead(!msg.alive);
  }

  onShot(msg) {
    const origin = msg.o;
    for (const ray of msg.rays) {
      this.effects.tracer(origin, ray);
      this.effects.impact(ray, false);
    }
    // msg.id is absent when the server decided we cannot see who fired: we get
    // the tracer and the noise, but no name attached to it.
    if (msg.id == null || msg.id !== this.selfId) {
      const v = msg.id != null ? this.views.get(msg.id) : null;
      const pos = v ? v.root.position : { x: origin[0], y: origin[1], z: origin[2] };
      this.audio.gunshot(msg.w, pos);
      // Only light up shooters we are allowed to see - a point light has no
      // shadows and would otherwise glow through the wall they are behind.
      if (v && v.root.visible) this.effects.flashAt(origin);
    }
  }

  onAbilityEvent(msg) {
    if (msg.id === this.selfId) {
      this.audio.ability();
      if (msg.label) this.hud.addFeed(escapeHtml(msg.label), 'good');
    }
    const v = this.views.get(msg.id);
    if (msg.kind === 'medic' && msg.target) {
      // Somebody just publicly patched somebody up. Loudest tell in the game.
      const a = this.views.get(msg.id), b = this.views.get(msg.target);
      const nameA = a ? a.name : 'Someone';
      const nameB = msg.target === this.selfId ? 'you' : (b ? b.name : 'someone');
      if (a || msg.target === this.selfId) {
        this.hud.addFeed(`<b>${escapeHtml(nameA)}</b> patches up <b>${escapeHtml(nameB)}</b>.`, 'good');
      }
    }
  }

  playReloadClicks(w) {
    const n = w.id === 'shotgun' ? 2 : 3;
    for (let i = 0; i < n; i++) {
      setTimeout(() => this.audio.reloadClick(i), (w.reloadTime * 1000 * (i + 0.5)) / (n + 0.5));
    }
  }

  // -------------------------------------------------------------- killcam
  /**
   * Replay the last few seconds from behind whoever shot you. The server only
   * sends the killer's and your own tracks, so this shows you nothing you were
   * not already told - it just makes it legible, and worth clipping.
   */
  startReplay(msg) {
    if (this.replay) this.endReplay();
    for (const [, v] of this.views) v.setVisible(false);
    const views = new Map();
    views.set(msg.killer, new PlayerView(this.scene, msg.killer, msg.killerName, msg.killerChar));
    views.set(msg.victim, new PlayerView(this.scene, msg.victim, 'YOU', msg.victimChar));
    this.replay = { ...msg, t0: performance.now() / 1000, views, pushed: 0, shotIdx: 0 };
    this.hud.showKillcam(msg);
  }

  endReplay() {
    if (!this.replay) return;
    for (const [, v] of this.replay.views) v.dispose(this.scene);
    this.replay = null;
    this.hud.hideKillcam();
    for (const [, v] of this.views) v.setVisible(true);
  }

  updateReplay(dt, t) {
    const r = this.replay;
    const elapsed = t - r.t0;
    if (elapsed > r.duration + 0.7) { this.endReplay(); return; }
    this.hud.killcamProgress(Math.min(1, elapsed / (r.duration + 0.7)));

    while (r.pushed < r.frames.length && r.frames[r.pushed].rt <= elapsed + INTERP_DELAY + 0.05) {
      const f = r.frames[r.pushed++];
      for (const e of f.ps) r.views.get(e.id)?.push(e, r.t0 + f.rt);
    }
    const renderTime = t - INTERP_DELAY;
    for (const [, v] of r.views) v.update(renderTime, dt, this.camera);

    while (r.shotIdx < r.shots.length && r.shots[r.shotIdx].rt <= elapsed) {
      const sh = r.shots[r.shotIdx++];
      for (const ray of sh.rays) { this.effects.tracer(sh.o, ray); this.effects.impact(ray, false); }
      this.effects.flashAt(sh.o);
      this.audio.gunshot(sh.w, { x: sh.o[0], y: sh.o[1], z: sh.o[2] });
    }

    // Chase camera behind the killer: their silhouette is the whole point.
    const kv = r.views.get(r.killer);
    if (kv) {
      const p = kv.root.position;
      const yaw = kv.body.rotation.y;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      const want = new THREE.Vector3(
        p.x + sin * REPLAY.camBack,
        p.y + 1.5 + REPLAY.camUp,
        p.z + cos * REPLAY.camBack,
      );
      if (!r.camReady) { this.camera.position.copy(want); r.camReady = true; }
      else this.camera.position.lerp(want, Math.min(1, dt * 6));
      this.camera.lookAt(p.x - sin * 5, p.y + 1.25, p.z - cos * 5);
    }
  }

  // ----------------------------------------------------------- game state
  enterGame() {
    this.endReplay();
    this.ensureWorld();
    this.inGame = true;
    this.hud.showMenu(false);
    this.hud.hideResults();
    this.effects.clearFootprints();
    for (const [, v] of this.views) v.dispose(this.scene);
    this.views.clear();
    this.self.alive = true;
    this.self.vel.set(0, 0, 0);
    this.self.stamina = PLAYER.staminaMax;
    this.lastCardAt = 0;
    this.lastAccuseAt = 0;
    this.audio.init();
    this.audio.resume();
    // No pointer lock yet - the role card is up and the player needs a cursor.
  }

  exitToResults() {
    document.exitPointerLock?.();
    this.hud.setDead(false);
  }

  onSelfDeath() {
    this.self.alive = false;
    this.hud.setDead(true);
    $('vignette').style.opacity = '0';
  }

  /**
   * The role card is shown with the cursor free. Any click or key dismisses it,
   * and THAT gesture is what we use to take pointer lock - which is both better
   * UX and the only moment a browser will reliably grant the lock.
   */
  dismissRoleCard() {
    const card = $('roleCard');
    if (this.peeking || card.classList.contains('hidden')) return false;
    card.classList.add('hidden');
    if (this.inGame) this.requestLock();
    this.hud.playDealAnimation();
    return true;
  }

  requestLock() {
    const canvas = $('view');
    if (!canvas.requestPointerLock || document.pointerLockElement === canvas) return;
    try {
      // Chrome returns a promise here and rejects it when there is no user
      // gesture (e.g. we entered the round from a server message). Swallow it:
      // the canvas click handler will pick the lock up on the player's next click.
      const r = canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* no gesture - fall back to click-to-lock */ }
  }

  // ---------------------------------------------------------------- input
  initInput() {
    const canvas = $('view');

    canvas.addEventListener('click', () => {
      if (this.inGame && !this.chatting && document.pointerLockElement !== canvas) this.requestLock();
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      const sens = this.sensitivity * (this.ads ? this.settings.get('adsScale') : 1);
      const invert = this.settings.get('invertY') ? -1 : 1;
      this.self.yaw -= e.movementX * sens;
      this.self.pitch = clamp(this.self.pitch - e.movementY * sens * invert, -1.52, 1.52);
      this.viewmodel.addSway(e.movementX, e.movementY);
    });

    document.addEventListener('mousedown', (e) => {
      if (this.replay) { this.endReplay(); return; }
      if (this.dismissRoleCard()) return;
      if (!this.inGame || document.pointerLockElement !== canvas) return;
      if (e.button === 0) { this.wantFire = true; this.tryFire(); }
      if (e.button === 2) this.ads = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.wantFire = false;
      if (e.button === 2) this.ads = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('keydown', (e) => {
      if (this.chatting) {
        if (e.key === 'Enter') {
          const text = $('chatInput').value.trim();
          if (text) this.send({ t: C.CHAT, text });
          this.chatting = false;
          this.hud.chatInput(false);
          this.requestLock();
        } else if (e.key === 'Escape') {
          this.chatting = false;
          this.hud.chatInput(false);
          this.requestLock();
        }
        return;
      }

      const k = e.code;
      if (this.keys.has(k)) return;
      this.keys.add(k);

      // Escape works everywhere, including the menu. In game the browser eats
      // the first press to release the pointer lock, so this is the second one.
      if (k === 'Escape' && !(this.inGame && this.dismissRoleCard())) {
        e.preventDefault();
        this.showSettings(!this.settingsOpen);
        return;
      }
      if (this.settingsOpen) return;

      if (!this.inGame) return;
      if (this.replay) { this.endReplay(); return; }
      if ((k === 'Space' || k === 'Enter' || k === 'Escape') && this.dismissRoleCard()) return;

      // Voice wheel: hold V, press a number.
      if (this.voiceOpen && /^Digit[1-8]$/.test(k)) {
        const idx = Number(k.slice(5)) - 1;
        if (VOICE_LINES[idx]) this.send({ t: C.VOICE, line: VOICE_LINES[idx].id });
        this.voiceOpen = false;
        this.hud.showVoiceWheel(false);
        return;
      }

      switch (k) {
        case 'KeyR': this.send({ t: C.RELOAD }); break;
        case 'Digit1': this.swapTo('revolver'); break;
        case 'Digit2': this.swapTo('shotgun'); break;
        case 'Digit3': this.swapTo('rifle'); break;
        case 'KeyQ': this.tryAbility(); break;
        case 'KeyE': this.tryPickup(); break;
        case 'KeyG': this.tryThrow(); break;
        case 'KeyF': this.tryAccuse(); break;
        case 'KeyB': this.tryBadge(); break;
        case 'KeyZ': this.playCard(0); break;
        case 'KeyX': this.playCard(1); break;
        case 'KeyV': this.voiceOpen = true; this.hud.showVoiceWheel(true); break;
        case 'KeyH': this.peeking = true; this.hud.peekRole(true); break;
        case 'Tab': e.preventDefault(); this.hud.toggleScoreboard(true); break;
        case 'KeyT':
          e.preventDefault();
          this.chatting = true;
          document.exitPointerLock?.();
          this.hud.chatInput(true, !this.self.alive);
          break;
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyV') { this.voiceOpen = false; this.hud.showVoiceWheel(false); }
      if (e.code === 'KeyH') { this.peeking = false; this.hud.peekRole(false); }
      if (e.code === 'Tab') this.hud.toggleScoreboard(false);
    });

    addEventListener('blur', () => this.keys.clear());
  }

  swapTo(slot) {
    if (!this.self.guns.includes(slot)) { this.audio.deny(); return; }
    if (this.self.weapon === slot) return;
    // Start the lockout here rather than waiting for the server to say so.
    // Without it the first clicks after a swap fired locally - flash, bang, a
    // round off the counter - and the server threw every one of them away.
    this.self.swapUntil = performance.now() / 1000 + swapTime(slot, this.character);
    this.send({ t: C.SWAP, slot });
  }

  /** Play a card out of the hand. The server owns every rule; this just names one. */
  playCard(i) {
    const id = this.hud.hand[i];
    if (!id || !this.self.alive) { this.audio.deny(); return; }
    // Two cards in the same breath is a rule, not a dropped keypress.
    const now = performance.now() / 1000;
    if (now - (this.lastCardAt || 0) < SOCIAL.cardCooldown) { this.audio.deny(); return; }
    this.lastCardAt = now;
    // No sound for the play itself yet: the server may refuse it (a Wanted
    // Poster with nobody in the crosshair), and the flick belongs to the card
    // actually leaving the hand.
    this.send({ t: C.CARD, card: id });
  }

  tryPickup() {
    const near = this.effects.nearestLoot(this.camera.position, 2.6);
    if (near) this.send({ t: C.PICKUP, id: near.id });
    else this.audio.deny();
  }

  /**
   * The cooldown ring is on screen, but a key that does nothing and makes no
   * sound reads as a dropped input rather than a rule.
   */
  tryAbility() {
    if (!this.self.alive || this.self.cd > 0) { this.audio.deny(); return; }
    this.send({ t: C.ABILITY });
  }

  tryThrow() {
    if (this.self.dyn <= 0) { this.audio.deny(); return; }
    this.send({ t: C.THROW, dir: this.aimDir() });
    this.viewmodel.throwAnim();
  }

  tryBadge() {
    // canBadge rather than a role check: the server decides who may pin it on,
    // and the client should not be the second place that rule is written down.
    if (!this.selfRole?.canBadge || this.self.badge) { this.audio.deny(); return; }
    this.send({ t: C.BADGE });
  }

  tryAccuse() {
    const now = performance.now() / 1000;
    const target = this.playerInCrosshair(60);
    if (!target || !this.self.alive || now - (this.lastAccuseAt || 0) < SOCIAL.accuseCooldown) {
      this.audio.deny();
      return;
    }
    this.lastAccuseAt = now;
    this.send({ t: C.ACCUSE, target: target.id });
  }

  playerInCrosshair(range) {
    const dir = this.aimDir();
    const origin = this.camera.position;
    let best = null, bestT = range;
    const ray = new THREE.Ray(origin, new THREE.Vector3(dir.x, dir.y, dir.z));
    const boxV = new THREE.Box3();
    for (const [, v] of this.views) {
      if (!v.alive) continue;
      boxV.setFromCenterAndSize(
        new THREE.Vector3(v.root.position.x, v.root.position.y + 0.95, v.root.position.z),
        new THREE.Vector3(1.5, 2.1, 1.5),
      );
      const hit = ray.intersectBox(boxV, new THREE.Vector3());
      if (hit) {
        const d = hit.distanceTo(origin);
        if (d < bestT) { bestT = d; best = v; }
      }
    }
    return best;
  }

  aimDir() {
    const cp = Math.cos(this.self.pitch);
    return {
      x: -Math.sin(this.self.yaw) * cp,
      y: Math.sin(this.self.pitch),
      z: -Math.cos(this.self.yaw) * cp,
    };
  }

  canFireLocally() {
    const s = this.self;
    const t = performance.now() / 1000;
    if (!s.alive || !this.inGame) return false;
    if (s.sprint && s.moving) return false;      // no shooting at a dead run
    if (s.mag <= 0 || s.reloading > 0) return false;
    if (t < s.nextFireAt || t < s.swapUntil) return false;
    return true;
  }

  tryFire() {
    const now = performance.now() / 1000;
    if (!this.canFireLocally()) {
      // An empty gun reloads itself. This runs every frame while the trigger
      // is held, and the server needs a round trip to answer, so ask once and
      // then wait for it rather than shouting sixty times a second.
      if (this.self.alive && this.self.mag <= 0 && this.self.reloading <= 0 && now >= this.reloadAskedAt) {
        this.reloadAskedAt = now + 0.5;
        this.send({ t: C.RELOAD });
      }
      return;
    }
    const s = this.self;
    const w = WEAPONS[s.weapon];
    const t = now;
    // Hair Trigger is the one thing in this town that fires faster than a hand
    // can work an action, and the server rations it by the same number.
    const hair = (s.buffs || []).includes('fireRateMult');
    // Every gun here is worked by hand - a hammer thumbed back, a lever thrown,
    // a breech broken open - so one press is one shot. Holding the button down
    // keeps the intent alive until the gun is ready for it, and no longer. The
    // five seconds of Hair Trigger are the exception, and the point of it.
    if (!w.auto && !hair) this.wantFire = false;
    // Predict locally so the click feels instant; the server still owns the hit.
    s.mag -= 1;
    s.nextFireAt = t + w.fireInterval * (hair ? BUFF_VALUES.fireRateMult : 1);
    this.send({ t: C.SHOOT, dir: this.aimDir(), ads: this.ads });
    this.viewmodel.kick(s.weapon);
    this.worldFlash.intensity = 7;
    this.audio.gunshot(s.weapon, this.self.pos);
    // The camera itself does not bob in this game; the only thing that moves
    // the view without the player asking is the kick, so that is what gets
    // damped when the browser says to reduce motion.
    this.recoilKick = (this.recoilKick || 0) + w.recoil * 0.0032 * motionScale(0.25);
    this.hud.setSelf({ ...this.lastSelfMsg, stam: s.stamina, mag: s.mag, reserve: s.reserve, hp: s.hp, maxHp: s.maxHp, weapon: s.weapon, guns: s.guns, dyn: s.dyn, cd: s.cd, cdMax: s.cdMax, active: s.active, armour: s.armour || 0, reloading: 0, badge: s.badge, buffs: s.buffs });
  }

  // ------------------------------------------------------------- movement
  updateLocal(dt) {
    if (this.replay) return;      // the killcam owns the camera while it runs
    const s = this.self;
    const wish = new THREE.Vector3();
    const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));

    if (this.inGame && !this.chatting) {
      if (this.keys.has('KeyW')) wish.add(fwd);
      if (this.keys.has('KeyS')) wish.sub(fwd);
      if (this.keys.has('KeyD')) wish.add(right);
      if (this.keys.has('KeyA')) wish.sub(right);
    }
    const wanted = wish.lengthSq() > 0.0001;
    if (wanted) wish.normalize();

    s.crouch = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC');
    const wantSprint = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'))
      && !s.crouch && wanted && !this.ads;
    // The same budget the server keeps, run locally so the feel is immediate.
    s.sprint = wantSprint && canSprint(s.stamina, s.sprint);
    s.moving = wanted;

    if (!s.alive) return this.updateSpectator(dt, wish, wanted);
    s.stamina = stepStamina(s.stamina, s.sprint, dt);

    let speed = s.crouch ? PLAYER.crouchSpeed : s.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if ((s.buffs || []).includes('speedMult')) speed *= BUFF_VALUES.speedMult;
    if (this.ads) speed *= PLAYER.adsSpeed;

    // Horizontal accel/friction
    const vel = s.vel;
    const horiz = new THREE.Vector3(vel.x, 0, vel.z);
    if (wanted) {
      const target = wish.multiplyScalar(speed);
      const accel = s.grounded ? PLAYER.accel : PLAYER.airAccel;
      horiz.lerp(target, Math.min(1, accel * dt / speed));
    } else if (s.grounded) {
      const drop = PLAYER.friction * dt;
      horiz.multiplyScalar(Math.max(0, 1 - drop));
    }
    vel.x = horiz.x; vel.z = horiz.z;

    if (this.keys.has('Space') && s.grounded) {
      vel.y = PLAYER.jumpSpeed;
      s.grounded = false;
    }
    vel.y -= PLAYER.gravity * dt;

    const height = s.crouch ? PLAYER.crouchHeight : PLAYER.height;
    const res = moveAndCollide(
      s.pos, { x: vel.x * dt, y: vel.y * dt, z: vel.z * dt },
      PLAYER.radius, height, MAP.solids, PLAYER.stepHeight,
    );
    s.pos.set(res.x, res.y, res.z);
    s.grounded = res.grounded;
    if (res.grounded && vel.y < 0) vel.y = 0;
    if (res.hitWall) { vel.x *= 0.82; vel.z *= 0.82; }   // scrub speed on a wall, keep sliding
    s.pos.x = clamp(s.pos.x, MAP.bounds.min + 1, MAP.bounds.max - 1);
    s.pos.z = clamp(s.pos.z, MAP.bounds.min + 1, MAP.bounds.max - 1);

    // Footsteps
    const hspeed = Math.hypot(vel.x, vel.z);
    const now = performance.now() / 1000;
    const interval = s.sprint ? 0.31 : s.crouch ? 0.62 : 0.44;
    if (s.grounded && hspeed > 1.2 && now - this.lastFootstep > interval) {
      this.lastFootstep = now;
      this.audio.footstep(s.sprint, s.pos.y);
    }

    // Camera
    const eye = s.crouch ? PLAYER.crouchEye : PLAYER.eye;
    s.eyeHeight += (eye - s.eyeHeight) * Math.min(1, dt * 12);
    this.recoilKick = (this.recoilKick || 0) * Math.max(0, 1 - dt * 7);
    this.camera.position.set(s.pos.x, s.pos.y + s.eyeHeight, s.pos.z);
    this.camera.rotation.set(s.pitch + this.recoilKick, s.yaw, 0);
    this.vmCamera.rotation.set(0, 0, 0);

    // Auto-fire hold for the click-happy (all weapons are semi, so this just
    // repeats at the weapon's own cadence).
    if (this.wantFire) this.tryFire();
  }

  updateSpectator(dt, wish, wanted) {
    const s = this.self;
    const speed = this.keys.has('ShiftLeft') ? 26 : 11;
    if (wanted) {
      const dir = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW')) move.add(dir);
      if (this.keys.has('KeyS')) move.sub(dir);
      if (this.keys.has('KeyD')) move.add(right);
      if (this.keys.has('KeyA')) move.sub(right);
      move.y = Math.sin(s.pitch) * (this.keys.has('KeyW') ? 1 : this.keys.has('KeyS') ? -1 : 0);
      move.normalize().multiplyScalar(speed * dt);
      s.pos.add(move);
    }
    if (this.keys.has('Space')) s.pos.y += speed * dt * 0.6;
    this.camera.position.set(s.pos.x, s.pos.y + 1.4, s.pos.z);
    this.camera.rotation.set(s.pitch, s.yaw, 0);
  }

  sendInput() {
    const s = this.self;
    if (!this.inGame) return;
    this.send({
      t: C.INPUT,
      pos: { x: r2(s.pos.x), y: r2(s.pos.y), z: r2(s.pos.z) },
      yaw: r2(s.yaw), pitch: r2(s.pitch),
      crouch: s.crouch, sprint: s.sprint,
      moving: s.moving && Math.hypot(s.vel.x, s.vel.z) > 0.8,
    });
  }

  // ---------------------------------------------------------------- frame
  start() {
    let last = performance.now();
    let inputAcc = 0;
    const loop = (nowMs) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const t = nowMs / 1000;

      this.updateLocal(dt);
      if (this.replay) this.updateReplay(dt, t);

      inputAcc += dt;
      if (inputAcc > 1 / INPUT_RATE) { inputAcc = 0; this.sendInput(); }

      const renderTime = t - INTERP_DELAY;
      if (!this.replay) for (const [, v] of this.views) v.update(renderTime, dt, this.camera);

      this.effects.update(dt, t);
      if (this.world) animateWorld(this.world, dt, t, this.camera);

      this.viewmodel.update(dt, {
        moving: this.self.moving,
        sprinting: this.self.sprint,
        grounded: this.self.grounded,
        ads: this.ads,
      });
      this.worldFlash.intensity *= Math.max(0, 1 - dt * 22);

      // Crosshair widens with movement and weapon, so it reads as accuracy.
      const w = WEAPONS[this.self.weapon];
      const spread = this.ads && w?.ads ? 0 : (this.self.moving ? (w?.spreadMoving || 0.03) : (w?.spread || 0.01));
      this.hud.setCrosshairSpread(Math.min(26, spread * 620));

      // Interaction prompt
      if (this.inGame && this.self.alive) {
        this.hud.interact(this.effects.nearestLoot(this.camera.position, 2.6));
      } else this.hud.interact(null);

      if (!this.inGame && this.phase === PHASE.LOBBY) this.hud.tickAutoStart();

      if (this.inGame) {
        this.hud.setTimer(this.phaseLeft);
        if (this.phase === PHASE.RESULTS) this.hud.setResultCountdown(this.phaseLeft);
      }

      this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.self.yaw);

      if (this.settings.get('showFps')) this.tickFps(t);

      this.renderer.render(this.scene, this.camera);
      // No first-person gun during a killcam, and none once you are dead: in
      // both cases you are watching the town rather than standing in it.
      const holding = !this.replay && !(this.inGame && this.self && this.self.alive === false);
      if (holding) {
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
        this.renderer.render(this.vmScene, this.vmCamera);
        this.renderer.autoClear = true;
      }
    };
    requestAnimationFrame(loop);
  }
}

const TOKEN_KEY = 'hnh.token';
function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || undefined; } catch { return undefined; }
}
function writeToken(token) {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* nothing to do */ }
}

function parseRoomFromUrl() {
  const hash = (location.hash || '').replace('#', '').trim().toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(hash)) return { room: hash };
  const q = new URLSearchParams(location.search).get('r');
  if (q && /^[A-Za-z0-9]{4}$/.test(q)) return { room: q.toUpperCase() };
  return {};
}

function r2(v) { return Math.round(v * 100) / 100; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Kick off character-model loading immediately, but do not block the socket on
// it. Resolves right away when client/models/characters.json names nothing.
const modelsLoading = initCharacterModels();

const game = new Game();
game.start();
window.game = game;
window.PV = PlayerView;   // handy for inspecting characters from the console
