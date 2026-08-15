// Client entry point: networking, local movement prediction, input, render loop.
//
// Movement is simulated here and reconciled loosely by the server; shooting is
// only ever *requested* here and resolved there. That split keeps the mouse feel
// tight without letting a client decide who died.

import * as THREE from 'three';
import MAP from '../../shared/map.js';
import { moveAndCollide } from '../../shared/collision.js';
import {
  PLAYER, WEAPONS, PHASE, VOICE_LINES, ENDGAME, clamp,
} from '../../shared/constants.js';
import { C, S } from '../../shared/protocol.js';
import { buildWorld, animateWorld } from './world.js';
import { PlayerView } from './players.js';
import { Effects } from './effects.js';
import { ViewModel } from './viewmodel.js';
import { GameAudio } from './audio.js';
import { HUD } from './hud.js';

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
    this.chatting = false;
    this.voiceOpen = false;

    this.self = {
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      crouch: false, sprint: false, grounded: true, moving: false,
      alive: false, hp: 100, maxHp: 100,
      weapon: 'revolver', mag: 6, reserve: 30, guns: ['revolver'], dyn: 0,
      reloading: 0, swapUntil: 0, nextFireAt: 0, cd: 0, active: 0, badge: false,
      eyeHeight: PLAYER.eye,
    };

    this.ring = 0;
    this.lastFootstep = 0;
    this.wantFire = false;
    this.ads = false;

    this.hud = new HUD(this);
    this.audio = new GameAudio();
    this.initThree();
    this.initInput();
    this.initMenu();
    this.connect();
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

    this.world = buildWorld(this.scene);
    this.effects = new Effects(this.scene);

    // The viewmodel lives in its own scene so it can never clip into a wall.
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 12);
    this.vmScene.add(this.vmCamera);
    this.vmScene.add(new THREE.AmbientLight(0xffe8cc, 2.0));
    const vmKey = new THREE.DirectionalLight(0xfff0d8, 2.6);
    vmKey.position.set(1.4, 1.8, 1.2);       // lights the side the player sees
    this.vmScene.add(vmKey);
    const vmFill = new THREE.DirectionalLight(0xbcd2ee, 0.9);
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
    $('botPlus').onclick = () => this.send({ t: C.ADD_BOT });
    $('botMinus').onclick = () => this.send({ t: C.ADD_BOT, remove: true });
    $('playAgain').onclick = () => {
      this.send({ t: C.RESTART });
      $('results').classList.add('hidden');
    };
    $('nameInput').value = localStorage.getItem('hnh_name') || '';
    $('nameInput').oninput = () => localStorage.setItem('hnh_name', $('nameInput').value);
    $('roleCard').onclick = () => this.dismissRoleCard();
  }

  // -------------------------------------------------------------- network
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => {
      this.hud.setStatus('connected — pick a gunhand and deal the roles');
      this.send({ t: C.JOIN, name: $('nameInput').value.trim() || undefined, character: this.character });
    };
    this.ws.onclose = () => this.hud.setStatus('connection lost — refresh to ride again');
    this.ws.onerror = () => this.hud.setStatus('connection error');
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this.onMessage(msg);
    };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  onMessage(msg) {
    switch (msg.t) {
      case S.WELCOME:
        if (msg.selfId) this.selfId = msg.selfId;
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
        this.hud.showRoleCard(msg);
        break;

      case S.PHASE:
        this.phase = msg.phase;
        this.hud.setPhase(msg);
        if ((msg.phase === PHASE.PREP || msg.phase === PHASE.COMBAT || msg.phase === PHASE.ENDGAME) && !this.inGame) {
          this.enterGame();
        }
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

      case S.FEED: this.hud.addFeed(escapeHtml(msg.text), msg.tone); break;
      case S.CHAT: this.hud.addChat(msg); break;

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

      case S.FOOTPRINTS:
        this.effects.showFootprints(msg.prints, msg.duration);
        this.hud.addFeed('You read the dust. Fresh prints, no names on them.', 'good');
        break;

      case S.BADGE:
        this.hud.addFeed(`<b>${escapeHtml(msg.name)}</b> pins on the star.`, 'badge');
        this.audio.blip(700, 0.4, 'triangle', 0.16, 1200);
        break;

      case S.RESULTS: this.hud.showResults(msg); break;
      case S.SOUND: if (msg.sound === 'bell') this.audio.bell(); break;
      case S.ERROR: this.hud.setStatus(msg.msg); break;
    }
  }

  onSnapshot(msg) {
    const now = performance.now() / 1000;
    this.phaseLeft = msg.left;
    this.ring = msg.ring;
    this.hud.updateRoster(msg.ps);

    const seen = new Set();
    for (const p of msg.ps) {
      seen.add(p.id);
      if (p.id === this.selfId) continue;
      let v = this.views.get(p.id);
      if (!v) {
        v = new PlayerView(this.scene, p.id, p.n, p.ch);
        this.views.set(p.id, v);
      }
      v.push(p, now);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { v.dispose(this.scene); this.views.delete(id); }
    }

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
    s.reserve = msg.reserve;
    s.reloading = msg.reloading;

    this.lastSelfMsg = msg;
    if (msg.loot) this.effects.syncLoot(msg.loot);
    if (wasWeapon !== msg.weapon) this.viewmodel.setWeapon(msg.weapon);
    if (!wasReloading && msg.reloading > 0) {
      this.viewmodel.startReload(WEAPONS[msg.weapon].reloadTime);
      this.playReloadClicks(WEAPONS[msg.weapon]);
    }
    this.hud.setSelf({ ...msg, hp: s.hp });
    this.hud.setDead(!msg.alive);
  }

  onShot(msg) {
    const origin = msg.o;
    for (const ray of msg.rays) {
      this.effects.tracer(origin, ray);
      this.effects.impact(ray, false);
    }
    if (msg.id !== this.selfId) {
      const v = this.views.get(msg.id);
      const pos = v ? v.root.position : { x: origin[0], y: origin[1], z: origin[2] };
      this.audio.gunshot(msg.w, pos);
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

  // ----------------------------------------------------------- game state
  enterGame() {
    this.inGame = true;
    this.hud.showMenu(false);
    this.hud.hideResults();
    this.effects.clearFootprints();
    for (const [, v] of this.views) v.dispose(this.scene);
    this.views.clear();
    this.self.alive = true;
    this.self.vel.set(0, 0, 0);
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
      const sens = this.sensitivity * (this.ads ? 0.55 : 1);
      this.self.yaw -= e.movementX * sens;
      this.self.pitch = clamp(this.self.pitch - e.movementY * sens, -1.52, 1.52);
      this.viewmodel.addSway(e.movementX, e.movementY);
    });

    document.addEventListener('mousedown', (e) => {
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

      if (!this.inGame) return;
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
        case 'KeyQ': this.send({ t: C.ABILITY }); break;
        case 'KeyE': this.tryPickup(); break;
        case 'KeyG': this.tryThrow(); break;
        case 'KeyF': this.tryAccuse(); break;
        case 'KeyB': this.tryBadge(); break;
        case 'KeyV': this.voiceOpen = true; this.hud.showVoiceWheel(true); break;
        case 'KeyH': this.peeking = true; this.hud.peekRole(true); break;
        case 'Tab': e.preventDefault(); this.hud.toggleScoreboard(true); break;
        case 'KeyT':
          e.preventDefault();
          this.chatting = true;
          document.exitPointerLock?.();
          this.hud.chatInput(true);
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
    this.send({ t: C.SWAP, slot });
  }

  tryPickup() {
    const near = this.effects.nearestLoot(this.camera.position, 2.6);
    if (near) this.send({ t: C.PICKUP, id: near.id });
    else this.audio.deny();
  }

  tryThrow() {
    if (this.self.dyn <= 0) { this.audio.deny(); return; }
    this.send({ t: C.THROW, dir: this.aimDir() });
    this.viewmodel.throwAnim();
  }

  tryBadge() {
    if (this.selfRole?.role !== 'sheriff' || this.self.badge) { this.audio.deny(); return; }
    this.send({ t: C.BADGE });
  }

  tryAccuse() {
    const target = this.playerInCrosshair(60);
    if (!target) { this.audio.deny(); return; }
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
    if (!this.canFireLocally()) {
      if (this.self.alive && this.self.mag <= 0 && this.self.reloading <= 0) this.send({ t: C.RELOAD });
      return;
    }
    const s = this.self;
    const w = WEAPONS[s.weapon];
    const t = performance.now() / 1000;
    // Predict locally so the click feels instant; the server still owns the hit.
    s.mag -= 1;
    s.nextFireAt = t + w.fireInterval;
    this.send({ t: C.SHOOT, dir: this.aimDir(), ads: this.ads });
    this.viewmodel.kick(s.weapon);
    this.worldFlash.intensity = 7;
    this.audio.gunshot(s.weapon, this.self.pos);
    this.recoilKick = (this.recoilKick || 0) + w.recoil * 0.0032;
    this.hud.setSelf({ ...this.lastSelfMsg, mag: s.mag, reserve: s.reserve, hp: s.hp, maxHp: s.maxHp, weapon: s.weapon, guns: s.guns, dyn: s.dyn, cd: s.cd, cdMax: s.cdMax, active: s.active, armour: s.armour || 0, reloading: 0, badge: s.badge, buffs: s.buffs });
  }

  // ------------------------------------------------------------- movement
  updateLocal(dt) {
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
    s.sprint = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !s.crouch && wanted && !this.ads;
    s.moving = wanted;

    if (!s.alive) return this.updateSpectator(dt, wish, wanted);

    let speed = s.crouch ? PLAYER.crouchSpeed : s.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if ((s.buffs || []).includes('speedMult')) speed *= 1.35;
    if (this.ads) speed *= 0.55;

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

      inputAcc += dt;
      if (inputAcc > 1 / 30) { inputAcc = 0; this.sendInput(); }

      const renderTime = t - INTERP_DELAY;
      for (const [, v] of this.views) v.update(renderTime, dt, this.camera);

      this.effects.update(dt, t);
      animateWorld(this.world, dt, t, this.camera);

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

      if (this.inGame) {
        this.hud.setTimer(this.phaseLeft);
        if (this.phase === PHASE.RESULTS) this.hud.setResultCountdown(this.phaseLeft);
      }

      this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.self.yaw);

      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
      this.renderer.autoClear = true;
    };
    requestAnimationFrame(loop);
  }
}

function r2(v) { return Math.round(v * 100) / 100; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const game = new Game();
game.start();
window.game = game;
window.PV = PlayerView;   // handy for inspecting characters from the console
