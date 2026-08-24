// The eighty, printed.
//
// Same press as cardart.js - same paper, same window, same two-colour drift,
// same trimmed corners - because these came out of the same job shop in the
// same town in the same year. Only the blocks are new.
//
// Nothing here is anybody's artwork. There is no image file in this repository
// and never has been: every line below is drawn at runtime onto a canvas, and
// what is drawn is what the card does, worked out from scratch. A card that
// makes a man throw something away is a hand tearing a card in half. That is
// not a design anybody owns; it is what the words say.
//
// Twenty-two blocks is a lot of bezier, so the ones that are the same object
// with a different barrel length are the same block with a different barrel
// length. Five of these cards are guns and they are all one function.

import { hatch, plate, plateUrl } from './cardart.js';
import { DUEL_CARDS } from '../../shared/deck.js';

const CX = 300, CY = 400;               // the middle of the picture window

// ---------------------------------------------------------------------------
// Parts the blocks are built out of
// ---------------------------------------------------------------------------

/** Outline, shade one flank, and leave the lit side clean. Every cut does this. */
function solid(g, shape, { angle = 0.3, gap = 7, lw = 3.2, lit = null } = {}) {
  g.lineWidth = lw;
  g.beginPath(); shape(g); g.stroke();
  hatch(g, shape, angle, gap, 1.4, 0.5);
  if (lit) {
    g.save();
    g.beginPath(); shape(g); g.clip();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#fff';
    g.fillRect(lit[0], lit[1], lit[2], lit[3]);
    g.restore();
  }
}

/** The ground under a thing, so it is standing somewhere rather than floating. */
function ground(g, y, w = 190) {
  g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(CX - w, y); g.lineTo(CX + w, y); g.stroke();
  g.lineWidth = 1.3;
  for (let i = -w + 14; i < w; i += 21) {
    g.beginPath();
    g.moveTo(CX + i, y + 3);
    g.lineTo(CX + i - 9, y + 13 + (i % 3) * 3);
    g.stroke();
  }
}

/** Rays off a point: a shot, a struck match, a thing that wants looking at. */
function rays(g, x, y, r0, r1, n = 12, from = 0, to = Math.PI * 2) {
  g.lineWidth = 2.4;
  for (let i = 0; i < n; i++) {
    const a = from + ((to - from) * i) / n;
    const long = i % 2 ? r1 : r1 * 0.72;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    g.lineTo(x + Math.cos(a) * long, y + Math.sin(a) * long);
    g.stroke();
  }
}

/**
 * A gun, side on, pointing left. Six of these cards are the same object with a
 * different barrel on it, so the differences are arguments: how long the barrel
 * is, whether it carries a cylinder or a tube, a lever, a stock.
 *
 * It is drawn as ONE closed outline - barrel, frame, guard and grip together -
 * because a gun cut into three shapes reads as three shapes with gaps between
 * them, which is exactly what the first attempt at this looked like.
 */
function gun(g, {
  barrel = 150, bore = 13, stock = false, lever = false, tube = false,
  cylinder = true, y = CY,
} = {}) {
  const fx = CX + 40;                                   // front of the frame
  const mx = fx - barrel;                               // the muzzle

  const body = (c) => {
    c.moveTo(mx, y - bore);
    c.lineTo(fx, y - bore);
    c.lineTo(fx + 22, y - bore - 12);                   // up over the top strap
    c.lineTo(fx + 84, y - bore - 8);
    if (stock) {
      c.lineTo(fx + 128, y + 10);                       // wrist
      c.lineTo(fx + 214, y + 58);                       // comb, back to the butt
      c.lineTo(fx + 228, y + 104);
      c.lineTo(fx + 186, y + 116);
      c.lineTo(fx + 120, y + 62);
      c.lineTo(fx + 84, y + 54);
    } else {
      c.lineTo(fx + 94, y + 30);                        // recoil shield
      c.bezierCurveTo(fx + 116, y + 74, fx + 112, y + 116, fx + 88, y + 138);
      c.lineTo(fx + 56, y + 130);                       // heel of the grip
      c.bezierCurveTo(fx + 56, y + 100, fx + 48, y + 76, fx + 42, y + 58);
    }
    c.lineTo(fx + 16, y + 62);                          // front of the guard
    c.lineTo(fx + 6, y + 34);
    c.lineTo(fx, y + bore);
    c.lineTo(mx, y + bore);
    c.closePath();
  };
  solid(g, body, { angle: 0.34, gap: 9, lw: 3.6, lit: [mx - 4, y - bore - 14, barrel + 70, 13] });

  // The bore, so the front end reads as a hole rather than a stub.
  g.lineWidth = 3;
  g.beginPath(); g.ellipse(mx, y, 4.5, bore, 0, 0, 7); g.stroke();
  // Foresight.
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(mx + 14, y - bore); g.lineTo(mx + 17, y - bore - 12);
  g.lineTo(mx + 26, y - bore - 12); g.lineTo(mx + 26, y - bore);
  g.stroke();
  // The line along the frame, which is what makes it a frame and not a lump.
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(fx + 4, y + bore - 4); g.lineTo(fx + 40, y + bore - 4); g.stroke();

  if (tube) {
    const mag = (c) => { c.rect(mx + 8, y + bore, barrel - 24, 18); };
    solid(g, mag, { angle: -0.42, gap: 9, lw: 2.8 });
  }

  if (cylinder) {
    const cyl = (c) => { c.ellipse(fx + 48, y + 6, 33, 34, 0, 0, 7); };
    g.lineWidth = 3.6;
    g.beginPath(); cyl(g); g.stroke();
    g.lineWidth = 2.2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      g.beginPath(); g.arc(fx + 48 + Math.cos(a) * 19, y + 6 + Math.sin(a) * 20, 6, 0, 7); g.stroke();
    }
    g.lineWidth = 2.6;
    g.beginPath(); g.arc(fx + 48, y + 6, 6, 0, 7); g.stroke();
  }

  // Hammer, cocked, sat on the back of the frame.
  const hammer = (c) => {
    c.moveTo(fx + 78, y - bore - 8);
    c.lineTo(fx + 88, y - bore - 42);
    c.lineTo(fx + 110, y - bore - 34);
    c.lineTo(fx + 104, y - bore - 6);
    c.closePath();
  };
  solid(g, hammer, { angle: -0.4, gap: 7, lw: 3.2 });

  if (lever) {
    g.lineWidth = 3.6;
    g.beginPath();
    g.moveTo(fx + 20, y + 60);
    g.bezierCurveTo(fx + 14, y + 112, fx + 78, y + 124, fx + 106, y + 88);
    g.stroke();
  }
  // Trigger, hanging in the guard.
  g.lineWidth = 3.2;
  g.beginPath();
  g.moveTo(fx + 30, y + 40); g.quadraticCurveTo(fx + 24, y + 52, fx + 28, y + 60);
  g.stroke();
  // Trigger guard, hanging below the line the outline already took.
  g.lineWidth = 3.4;
  g.beginPath();
  g.moveTo(fx + 12, y + 60);
  g.bezierCurveTo(fx + 16, y + 96, fx + 48, y + 96, fx + 50, y + 64);
  g.stroke();
}

/** A playing card, face down, at an angle. Four blocks want one of these. */
function pasteboard(g, x, y, rot, w = 62, h = 88) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  const card = (c) => { c.rect(-w / 2, -h / 2, w, h); };
  solid(g, card, { angle: -0.5, gap: 9, lw: 3 });
  g.lineWidth = 1.6;
  g.strokeRect(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14);
  g.beginPath(); g.arc(0, 0, 9, 0, 7); g.stroke();
  g.restore();
}

// ---------------------------------------------------------------------------
// The blocks
// ---------------------------------------------------------------------------
export const CUT = {
  // A cartridge stood on end, going off. The only card that fires anything.
  bang(g) {
    const w = 34, top = 300, bot = 520;
    const shell = (c) => {
      c.moveTo(CX - w, bot); c.lineTo(CX - w, top + 54);
      c.bezierCurveTo(CX - w, top + 12, CX - 12, top, CX, top);
      c.bezierCurveTo(CX + 12, top, CX + w, top + 12, CX + w, top + 54);
      c.lineTo(CX + w, bot); c.closePath();
    };
    solid(g, shell, { angle: 0.4, gap: 8, lw: 3.6, lit: [CX - w - 4, top - 4, 26, 300] });
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(CX - w, top + 62); g.lineTo(CX + w, top + 62); g.stroke();
    g.beginPath(); g.moveTo(CX - w - 8, bot - 40); g.lineTo(CX + w + 8, bot - 40); g.stroke();
    g.beginPath(); g.moveTo(CX - w - 8, bot - 40); g.lineTo(CX - w - 8, bot); g.lineTo(CX + w + 8, bot);
    g.lineTo(CX + w + 8, bot - 40); g.stroke();
    rays(g, CX, top - 6, 26, 96, 11, Math.PI + 0.35, Math.PI * 2 - 0.35);
  },

  // A hat with daylight through it, still on its way to the floor.
  missed(g) {
    const y = CY + 20;
    const brim = (c) => { c.ellipse(CX, y + 52, 148, 34, 0, 0, 7); };
    solid(g, brim, { angle: -0.3, gap: 8, lw: 3.4 });
    const crown = (c) => {
      c.moveTo(CX - 74, y + 46);
      c.bezierCurveTo(CX - 82, y - 40, CX - 52, y - 78, CX, y - 78);
      c.bezierCurveTo(CX + 52, y - 78, CX + 82, y - 40, CX + 74, y + 46);
      c.closePath();
    };
    solid(g, crown, { angle: 0.36, gap: 8, lw: 3.4, lit: [CX + 2, y - 84, 84, 96] });
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(CX - 78, y + 20); g.lineTo(CX + 78, y + 20); g.stroke();
    // One hole, torn rather than punched, off to one side of the crown - two
    // would be symmetrical, and two symmetrical holes in a hat are a face.
    const hx = CX + 42, hy = y - 40;
    const hole = (c) => {
      c.moveTo(hx + 17, hy - 4);
      c.lineTo(hx + 6, hy - 19); c.lineTo(hx - 5, hy - 13); c.lineTo(hx - 17, hy - 2);
      c.lineTo(hx - 9, hy + 14); c.lineTo(hx + 5, hy + 19); c.lineTo(hx + 14, hy + 10);
      c.closePath();
    };
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#fff';
    g.beginPath(); hole(g); g.fill();
    g.restore();
    g.lineWidth = 3;
    g.beginPath(); hole(g); g.stroke();
    // And the line the shot took on its way through, which is the whole card:
    // it did not stop in there, and it did not stop in him either.
    g.lineWidth = 1.8;
    g.globalAlpha = 0.5;
    g.setLineDash([10, 9]);
    g.beginPath(); g.moveTo(hx + 168, hy - 40); g.lineTo(hx - 200, hy + 46); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  },

  // A mug, warm, flat, and the best thing that has happened all day.
  beer(g) {
    const l = CX - 92, r = CX + 52, top = 320, bot = 528;
    const mug = (c) => {
      c.moveTo(l, top + 30); c.lineTo(l + 10, bot); c.lineTo(r - 10, bot); c.lineTo(r, top + 30);
      c.closePath();
    };
    solid(g, mug, { angle: 0.34, gap: 8, lw: 3.6, lit: [l - 4, top, 46, 260] });
    const handle = (c) => {
      c.moveTo(r - 4, top + 66);
      c.bezierCurveTo(r + 78, top + 58, r + 78, bot - 66, r - 6, bot - 62);
      c.lineTo(r - 6, bot - 82);
      c.bezierCurveTo(r + 54, bot - 86, r + 54, top + 84, r - 4, top + 88);
      c.closePath();
    };
    solid(g, handle, { angle: -0.4, gap: 9, lw: 3.2 });
    // Foam over the rim.
    const foam = (c) => {
      c.moveTo(l - 4, top + 34);
      for (let i = 0; i <= 6; i++) {
        const x = l - 4 + ((r + 4 - (l - 4)) * i) / 6;
        c.quadraticCurveTo(x + 12, top - 26 - (i % 2) * 14, x + 24, top + 6);
      }
      c.lineTo(r + 4, top + 34); c.closePath();
    };
    g.lineWidth = 3.2;
    g.beginPath(); foam(g); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(l + 4, top + 76); g.lineTo(r - 4, top + 76); g.stroke();
  },

  // Batwing doors, still swinging. The house is buying.
  saloon(g) {
    const top = 268, bot = 556, gap = 16;
    g.lineWidth = 3.6;
    g.beginPath();
    g.moveTo(CX - 190, top - 8); g.lineTo(CX - 190, bot + 10);
    g.moveTo(CX + 190, top - 8); g.lineTo(CX + 190, bot + 10);
    g.moveTo(CX - 206, top - 8); g.lineTo(CX + 206, top - 8);
    g.stroke();
    for (const side of [-1, 1]) {
      const x0 = CX + side * gap, x1 = CX + side * 176;
      const door = (c) => {
        c.moveTo(Math.min(x0, x1), top + 62);
        c.lineTo(Math.max(x0, x1), top + 62);
        c.lineTo(Math.max(x0, x1), bot - 46);
        c.lineTo(Math.min(x0, x1), bot - 46);
        c.closePath();
      };
      solid(g, door, { angle: side > 0 ? 0.34 : -0.34, gap: 9, lw: 3.2 });
      g.lineWidth = 2.2;
      for (let i = 1; i < 5; i++) {
        const y = top + 62 + ((bot - 108 - top) * i) / 5 + 10;
        g.beginPath(); g.moveTo(Math.min(x0, x1) + 6, y); g.lineTo(Math.max(x0, x1) - 6, y); g.stroke();
      }
    }
    ground(g, bot + 10, 206);
  },

  // A wheel, and the coach it came in on.
  stagecoach(g) {
    const box = (c) => {
      c.moveTo(CX - 168, 300); c.lineTo(CX + 128, 300);
      c.lineTo(CX + 150, 420); c.lineTo(CX - 156, 420); c.closePath();
    };
    solid(g, box, { angle: 0.32, gap: 8, lw: 3.4, lit: [CX - 172, 296, 120, 60] });
    g.lineWidth = 2.4;
    g.beginPath(); g.rect(CX - 128, 318, 78, 60); g.stroke();
    g.beginPath(); g.rect(CX + 24, 318, 78, 60); g.stroke();
    // Wheels: a big one behind, a small one in front, spokes and all.
    for (const [x, r] of [[CX - 96, 62], [CX + 86, 84]]) {
      g.lineWidth = 3.4;
      g.beginPath(); g.arc(x, 470, r, 0, 7); g.stroke();
      g.lineWidth = 2;
      g.beginPath(); g.arc(x, 470, r - 11, 0, 7); g.stroke();
      g.beginPath(); g.arc(x, 470, 11, 0, 7); g.stroke();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        g.beginPath();
        g.moveTo(x + Math.cos(a) * 11, 470 + Math.sin(a) * 11);
        g.lineTo(x + Math.cos(a) * (r - 11), 470 + Math.sin(a) * (r - 11));
        g.stroke();
      }
    }
    ground(g, 556, 200);
  },

  // A strongbox nobody thought to guard.
  wells(g) {
    const top = 320, bot = 528, l = CX - 168, r = CX + 168;
    const chest = (c) => {
      c.moveTo(l, top + 54); c.lineTo(l, bot); c.lineTo(r, bot); c.lineTo(r, top + 54);
      c.closePath();
    };
    solid(g, chest, { angle: 0.32, gap: 8, lw: 3.6, lit: [l - 4, top, 90, 240] });
    const lid = (c) => {
      c.moveTo(l, top + 54);
      c.bezierCurveTo(l + 20, top - 14, r - 20, top - 14, r, top + 54);
      c.closePath();
    };
    solid(g, lid, { angle: -0.4, gap: 9, lw: 3.4 });
    g.lineWidth = 3;
    for (const x of [l + 46, r - 46]) {
      g.beginPath(); g.moveTo(x, top + 24); g.lineTo(x, bot); g.stroke();
    }
    g.beginPath(); g.moveTo(l, bot - 44); g.lineTo(r, bot - 44); g.stroke();
    // Hasp and padlock.
    g.lineWidth = 3.2;
    g.beginPath(); g.rect(CX - 26, top + 40, 52, 60); g.stroke();
    g.beginPath(); g.arc(CX, top + 40, 17, Math.PI, 0); g.stroke();
    g.beginPath(); g.arc(CX, top + 74, 7, 0, 7); g.fill();
  },

  // A shelf, and everyone watching what you reach for.
  store(g) {
    g.lineWidth = 3.6;
    for (const y of [318, 420, 522]) {
      g.beginPath(); g.moveTo(CX - 186, y); g.lineTo(CX + 186, y); g.stroke();
    }
    g.beginPath(); g.moveTo(CX - 186, 268); g.lineTo(CX - 186, 534); g.stroke();
    g.beginPath(); g.moveTo(CX + 186, 268); g.lineTo(CX + 186, 534); g.stroke();
    const jar = (x, y, w, h, round) => {
      const shape = (c) => {
        if (round) { c.ellipse(x, y - h / 2, w / 2, h / 2, 0, 0, 7); return; }
        c.moveTo(x - w / 2, y); c.lineTo(x - w / 2, y - h + 10);
        c.quadraticCurveTo(x - w / 2, y - h, x, y - h);
        c.quadraticCurveTo(x + w / 2, y - h, x + w / 2, y - h + 10);
        c.lineTo(x + w / 2, y); c.closePath();
      };
      solid(g, shape, { angle: 0.36, gap: 7, lw: 2.8, lit: [x - w / 2 - 2, y - h - 2, w * 0.34, h + 4] });
    };
    jar(CX - 132, 318, 46, 74, false);
    jar(CX - 62, 318, 34, 56, false);
    jar(CX + 8, 318, 54, 70, true);
    jar(CX + 90, 318, 40, 64, false);
    jar(CX + 146, 318, 30, 44, false);
    jar(CX - 118, 420, 60, 62, true);
    jar(CX - 30, 420, 38, 76, false);
    jar(CX + 44, 420, 48, 58, false);
    jar(CX + 128, 420, 44, 70, false);
  },

  // A hand out of the dark, taking something that was not offered.
  panic(g) {
    pasteboard(g, CX + 46, CY - 30, 0.24, 92, 128);
    const arm = (c) => {
      c.moveTo(CX - 200, CY + 128);
      c.lineTo(CX - 154, CY + 46);
      c.lineTo(CX - 30, CY + 72);
      c.lineTo(CX - 60, CY + 150);
      c.closePath();
    };
    solid(g, arm, { angle: 0.4, gap: 8, lw: 3.4 });
    // Fingers, closing on the corner of it.
    g.lineWidth = 3.4;
    for (let i = 0; i < 4; i++) {
      const y = CY + 56 + i * 22;
      g.beginPath();
      g.moveTo(CX - 34, y);
      g.bezierCurveTo(CX + 34, y - 16, CX + 46, y - 44, CX + 16, y - 52);
      g.stroke();
    }
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(CX - 44, CY + 132);
    g.bezierCurveTo(CX + 4, CY + 128, CX + 20, CY + 96, CX - 4, CY + 82);
    g.stroke();
  },

  // Spite carries further than a bullet: a card torn in half.
  catbalou(g) {
    for (const side of [-1, 1]) {
      g.save();
      g.translate(CX + side * 78, CY + side * 12);
      g.rotate(side * 0.22);
      const half = (c) => {
        const w = 84, h = 150;
        if (side < 0) {
          c.moveTo(-w, -h); c.lineTo(6, -h);
          c.lineTo(-8, -h / 3); c.lineTo(10, 6); c.lineTo(-6, h / 3); c.lineTo(4, h);
          c.lineTo(-w, h);
        } else {
          c.moveTo(w, -h); c.lineTo(-6, -h);
          c.lineTo(8, -h / 3); c.lineTo(-10, 6); c.lineTo(6, h / 3); c.lineTo(-4, h);
          c.lineTo(w, h);
        }
        c.closePath();
      };
      solid(g, half, { angle: side * 0.5, gap: 9, lw: 3.2 });
      g.restore();
    }
    // A few scraps on their way down.
    g.lineWidth = 2.4;
    for (const [x, y, r] of [[CX - 150, CY + 156, 0.7], [CX + 132, CY + 172, -0.5], [CX + 8, CY + 190, 0.2]]) {
      g.save(); g.translate(x, y); g.rotate(r);
      g.beginPath(); g.moveTo(-14, -8); g.lineTo(12, -12); g.lineTo(16, 10); g.lineTo(-10, 12); g.closePath();
      g.stroke(); g.restore();
    }
  },

  // Dust on the ridge, and everybody suddenly has somewhere to be.
  indians(g) {
    const ridge = (c) => {
      c.moveTo(CX - 210, 470);
      c.lineTo(CX - 132, 402); c.lineTo(CX - 74, 424); c.lineTo(CX - 6, 372);
      c.lineTo(CX + 72, 416); c.lineTo(CX + 142, 386); c.lineTo(CX + 210, 448);
      c.lineTo(CX + 210, 500); c.lineTo(CX - 210, 500); c.closePath();
    };
    solid(g, ridge, { angle: 0.24, gap: 6, lw: 3.4 });
    // The dust, which is the whole of what anybody actually sees.
    g.lineWidth = 2.6;
    for (let i = 0; i < 5; i++) {
      const x = CX - 120 + i * 62, h = 74 + (i % 3) * 34;
      g.beginPath();
      g.moveTo(x - 26, 400 - (i % 2) * 14);
      g.bezierCurveTo(x - 40, 400 - h, x + 30, 400 - h - 20, x + 26, 400 - (i % 2) * 14);
      g.stroke();
    }
    g.lineWidth = 1.8;
    g.globalAlpha = 0.6;
    for (let i = 0; i < 22; i++) {
      const a = (i * 2.399) % (Math.PI * 2);
      const x = CX + Math.cos(a) * (60 + (i % 5) * 30);
      const y = 330 + Math.sin(a) * (26 + (i % 4) * 14);
      g.beginPath(); g.arc(x, y, 3 + (i % 3), 0, 7); g.stroke();
    }
    g.globalAlpha = 1;
    ground(g, 512, 208);
  },

  // It does not aim. That is the point of it.
  gatling(g) {
    // The barrel cluster, seen a little from the front.
    g.lineWidth = 3.4;
    const cluster = (c) => { c.ellipse(CX - 96, CY - 26, 46, 50, 0, 0, 7); };
    g.beginPath(); cluster(g); g.stroke();
    hatch(g, cluster, 0.3, 8, 1.4, 0.4);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      g.lineWidth = 2.6;
      g.beginPath(); g.arc(CX - 96 + Math.cos(a) * 28, CY - 26 + Math.sin(a) * 30, 11, 0, 7); g.stroke();
    }
    // Barrels running back to the breech.
    const barrels = (c) => {
      c.moveTo(CX - 96, CY - 78); c.lineTo(CX + 68, CY - 62);
      c.lineTo(CX + 68, CY + 14); c.lineTo(CX - 96, CY + 26); c.closePath();
    };
    solid(g, barrels, { angle: 0.34, gap: 7, lw: 3.2, lit: [CX - 100, CY - 84, 170, 26] });
    // Crank and carriage wheel.
    g.lineWidth = 3.2;
    g.beginPath(); g.arc(CX + 92, CY - 12, 22, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(CX + 92, CY - 12); g.lineTo(CX + 128, CY + 14); g.lineTo(CX + 140, CY + 4); g.stroke();
    g.lineWidth = 3.4;
    g.beginPath(); g.arc(CX + 24, CY + 106, 74, 0, 7); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.arc(CX + 24, CY + 106, 63, 0, 7); g.stroke();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.beginPath();
      g.moveTo(CX + 24 + Math.cos(a) * 8, CY + 106 + Math.sin(a) * 8);
      g.lineTo(CX + 24 + Math.cos(a) * 63, CY + 106 + Math.sin(a) * 63);
      g.stroke();
    }
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(CX - 20, CY + 20); g.lineTo(CX + 24, CY + 106); g.stroke();
  },

  // Two men, and however many bullets they were carrying.
  duel(g) {
    // Crossed, and pointing at each other, which is the whole card.
    g.save(); g.translate(CX + 24, CY - 108); g.rotate(0.3); g.scale(0.62, 0.62);
    g.translate(-CX, -CY); gun(g, { barrel: 168 }); g.restore();
    g.save(); g.translate(CX - 24, CY + 132); g.rotate(Math.PI + 0.3); g.scale(0.62, 0.62);
    g.translate(-CX, -CY); gun(g, { barrel: 168 }); g.restore();
  },

  // Half a barrel of rainwater stops more lead than most men believe.
  barrel(g) {
    const top = 290, bot = 546, hw = 122;
    const body = (c) => {
      c.moveTo(CX - hw + 18, top);
      c.bezierCurveTo(CX - hw - 14, top + 88, CX - hw - 14, bot - 88, CX - hw + 22, bot);
      c.lineTo(CX + hw - 22, bot);
      c.bezierCurveTo(CX + hw + 14, bot - 88, CX + hw + 14, top + 88, CX + hw - 18, top);
      c.closePath();
    };
    solid(g, body, { angle: 0.3, gap: 7, lw: 3.6, lit: [CX - 54, top - 20, 200, 300] });
    g.lineWidth = 3.4;
    for (const y of [top + 34, bot - 34]) {
      g.beginPath();
      g.moveTo(CX - hw - 6, y); g.bezierCurveTo(CX - 40, y + 12, CX + 40, y + 12, CX + hw + 6, y);
      g.stroke();
    }
    g.lineWidth = 2;
    for (let i = -3; i <= 3; i++) {
      const x = CX + i * 32;
      g.beginPath();
      g.moveTo(x, top + 6); g.bezierCurveTo(x - i * 5, top + 100, x - i * 5, bot - 100, x, bot - 6);
      g.stroke();
    }
    // The open top, with the rainwater still in it.
    g.lineWidth = 3.2;
    g.beginPath(); g.ellipse(CX, top, hw - 18, 26, 0, 0, 7); g.stroke();
    g.lineWidth = 1.8;
    g.beginPath(); g.ellipse(CX, top + 6, hw - 34, 17, 0, 0, 7); g.stroke();
  },

  // Brass, cracked, taken off a surveyor who had stopped needing it.
  scope(g) {
    g.save(); g.translate(CX, CY); g.rotate(-0.2); g.translate(-CX, -CY);
    const tube = (c) => {
      c.moveTo(CX - 176, CY - 30); c.lineTo(CX + 60, CY - 38);
      c.lineTo(CX + 60, CY + 38); c.lineTo(CX - 176, CY + 30); c.closePath();
    };
    solid(g, tube, { angle: 0.34, gap: 8, lw: 3.4, lit: [CX - 180, CY - 42, 250, 24] });
    const bell = (c) => {
      c.moveTo(CX + 60, CY - 50); c.lineTo(CX + 156, CY - 62);
      c.lineTo(CX + 156, CY + 62); c.lineTo(CX + 60, CY + 50); c.closePath();
    };
    solid(g, bell, { angle: -0.4, gap: 9, lw: 3.4 });
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(CX + 156, CY, 12, 62, 0, 0, 7); g.stroke();
    g.beginPath(); g.ellipse(CX - 176, CY, 7, 30, 0, 0, 7); g.stroke();
    // Rings, and the elevation turret.
    for (const x of [CX - 96, CX + 6]) {
      g.lineWidth = 3.2;
      g.beginPath(); g.rect(x - 9, CY - 44, 18, 88); g.stroke();
    }
    g.lineWidth = 3;
    g.beginPath(); g.rect(CX - 52, CY - 62, 34, 24); g.stroke();
    g.restore();
    // Crosshairs in the glass.
    g.lineWidth = 2;
    g.save();
    g.beginPath(); g.ellipse(CX + 154, CY - 32, 11, 60, -0.2, 0, 7); g.clip();
    g.beginPath(); g.moveTo(CX + 120, CY - 32); g.lineTo(CX + 190, CY - 32);
    g.moveTo(CX + 154, CY - 100); g.lineTo(CX + 154, CY + 40); g.stroke();
    g.restore();
  },

  // Nervy, fast, and no friend of anybody.
  mustang(g) {
    const head = (c) => {
      c.moveTo(CX - 6, CY + 154);                        // throat, at the bottom
      c.bezierCurveTo(CX - 70, CY + 92, CX - 78, CY + 10, CX - 40, CY - 46);
      c.lineTo(CX - 26, CY - 74);
      c.lineTo(CX - 46, CY - 138);                       // near ear
      c.lineTo(CX + 8, CY - 88);
      c.lineTo(CX + 34, CY - 136);                       // far ear
      c.lineTo(CX + 38, CY - 78);
      c.bezierCurveTo(CX + 84, CY - 52, CX + 112, CY + 6, CX + 106, CY + 58);
      c.bezierCurveTo(CX + 104, CY + 84, CX + 88, CY + 96, CX + 70, CY + 90);
      c.bezierCurveTo(CX + 62, CY + 124, CX + 66, CY + 144, CX + 72, CY + 158);
      c.closePath();
    };
    solid(g, head, { angle: 0.34, gap: 8, lw: 3.6, lit: [CX + 10, CY - 150, 120, 240] });
    // Eye, nostril, and the line of the cheek.
    g.lineWidth = 3.2;
    g.beginPath(); g.ellipse(CX + 8, CY - 24, 11, 9, 0.25, 0, 7); g.stroke();
    g.beginPath(); g.arc(CX + 92, CY + 48, 9, 0, 7); g.stroke();
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(CX - 20, CY + 6);
    g.bezierCurveTo(CX + 18, CY + 30, CX + 52, CY + 52, CX + 74, CY + 78);
    g.stroke();
    // Mane, thrown back off the neck.
    g.lineWidth = 3.4;
    for (let i = 0; i < 7; i++) {
      const y = CY - 104 + i * 30;
      g.beginPath();
      g.moveTo(CX - 34 - i * 3, y);
      g.bezierCurveTo(CX - 104 - i * 6, y + 10, CX - 128 - i * 4, y + 42, CX - 92 - i * 3, y + 62);
      g.stroke();
    }
  },

  // One key, and the man holding it has other things on his mind.
  jail(g) {
    const l = CX - 156, r = CX + 156, top = 288, bot = 552;
    const wall = (c) => { c.rect(l - 34, top - 30, (r - l) + 68, (bot - top) + 60); };
    g.lineWidth = 3.6;
    g.beginPath(); wall(g); g.stroke();
    // Coursed stone round the opening.
    g.lineWidth = 1.8;
    for (let y = top - 30; y < bot + 60; y += 44) {
      g.beginPath(); g.moveTo(l - 34, y); g.lineTo(r + 34, y); g.stroke();
    }
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#fff';
    g.fillRect(l, top, r - l, bot - top);
    g.restore();
    g.lineWidth = 3.4;
    g.strokeRect(l, top, r - l, bot - top);
    // Bars, and the dark behind them.
    g.lineWidth = 5;
    for (let i = 1; i < 6; i++) {
      const x = l + ((r - l) * i) / 6;
      g.beginPath(); g.moveTo(x, top + 6); g.lineTo(x, bot - 6); g.stroke();
    }
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(l + 6, top + 62); g.lineTo(r - 6, top + 62); g.stroke();
    g.beginPath(); g.moveTo(l + 6, bot - 62); g.lineTo(r - 6, bot - 62); g.stroke();
  },

  // Nobody remembers who lit it.
  dynamite(g) {
    const y0 = CY + 34;
    for (const [dx, dy, r] of [[-58, 6, -0.06], [0, -6, 0.02], [58, 8, 0.07]]) {
      g.save();
      g.translate(CX + dx, y0 + dy); g.rotate(r);
      const stick = (c) => { c.rect(-30, -118, 60, 236); };
      solid(g, stick, { angle: 0.34, gap: 8, lw: 3.4, lit: [-32, -120, 20, 240] });
      g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(-30, -78); g.lineTo(30, -78); g.moveTo(-30, 78); g.lineTo(30, 78); g.stroke();
      g.restore();
    }
    // The band round the bundle.
    g.lineWidth = 3.6;
    g.beginPath(); g.rect(CX - 96, y0 - 34, 192, 62); g.stroke();
    // The fuse, and the end of it that matters.
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(CX, y0 - 122);
    g.bezierCurveTo(CX + 44, y0 - 168, CX - 30, y0 - 196, CX + 36, y0 - 232);
    g.stroke();
    rays(g, CX + 40, y0 - 240, 12, 40, 10);
    g.beginPath(); g.arc(CX + 40, y0 - 240, 9, 0, 7); g.fill();
  },

  // Ten shots and no patience. Short, fat, and all magazine.
  volcanic(g) { gun(g, { barrel: 110, bore: 15, cylinder: false, tube: true, lever: true }); },

  // Breaks open, empties itself, and is loaded again before he has finished falling.
  schofield(g) { gun(g, { barrel: 168, bore: 13 }); },

  // Heavy enough to be a poor idea in a bar fight.
  remington(g) { gun(g, { barrel: 214, bore: 16 }); },

  // A cavalry gun, a long way from the cavalry.
  carabine(g) { gun(g, { barrel: 236, bore: 13, stock: true, lever: true, cylinder: false }); },

  // You will hear it before you have worked out where it came from.
  winchester(g) {
    gun(g, { barrel: 310, bore: 13, stock: true, lever: true, tube: true, cylinder: false });
  },
};

// ---------------------------------------------------------------------------
// The window each block sits in, eyeballed against a proof sheet
// ---------------------------------------------------------------------------
export const FIT = {
  bang: { s: 1.0, x: 0, y: 0 },
  missed: { s: 1.08, x: 0, y: 10 },
  beer: { s: 1.02, x: 6, y: 0 },
  saloon: { s: 0.94, x: 0, y: 0 },
  stagecoach: { s: 0.96, x: 0, y: -8 },
  wells: { s: 1.02, x: 0, y: 0 },
  store: { s: 0.96, x: 0, y: 0 },
  panic: { s: 0.94, x: 12, y: -14 },
  catbalou: { s: 0.9, x: 0, y: -18 },
  indians: { s: 0.98, x: 0, y: 6 },
  gatling: { s: 0.92, x: -6, y: -6 },
  duel: { s: 0.98, x: 0, y: 0 },
  barrel: { s: 1.02, x: 0, y: -6 },
  scope: { s: 0.94, x: -6, y: 0 },
  mustang: { s: 0.92, x: -6, y: 0 },
  jail: { s: 0.92, x: 0, y: 0 },
  dynamite: { s: 0.86, x: -8, y: 22 },
  volcanic: { s: 1.16, x: -34, y: -22 },
  schofield: { s: 1.0, x: -30, y: -22 },
  remington: { s: 0.9, x: -20, y: -20 },
  carabine: { s: 0.8, x: -34, y: -14 },
  winchester: { s: 0.68, x: -22, y: -12 },
};

// ---------------------------------------------------------------------------
// Corner marks: an inch of a card, which is all you see of one in a fanned hand
// ---------------------------------------------------------------------------
const pipRing = (g, r, lw = 2.2) => { g.lineWidth = lw; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); };
const pipGun = (g, len) => {
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(-len, -3); g.lineTo(4, -3); g.lineTo(8, -7); g.lineTo(12, 2); g.lineTo(8, 12); g.lineTo(2, 12);
  g.lineTo(2, 3); g.lineTo(-len, 3); g.closePath();
  g.stroke();
};

export const PIP = {
  bang(g) {
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(-6, 12); g.lineTo(-6, -4); g.quadraticCurveTo(-6, -12, 0, -12);
    g.quadraticCurveTo(6, -12, 6, -4); g.lineTo(6, 12); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-7, 6); g.lineTo(7, 6); g.stroke();
  },
  missed(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(0, 8, 13, 4.5, 0, 0, 7); g.stroke();
    g.beginPath();
    g.moveTo(-8, 6); g.bezierCurveTo(-9, -8, -5, -12, 0, -12);
    g.bezierCurveTo(5, -12, 9, -8, 8, 6); g.stroke();
    g.beginPath(); g.arc(3, -3, 2.4, 0, 7); g.fill();
  },
  beer(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(-8, -8); g.lineTo(-6, 12); g.lineTo(5, 12); g.lineTo(7, -8); g.closePath(); g.stroke();
    g.beginPath(); g.arc(9, 0, 6, -1.2, 1.2); g.stroke();
    g.beginPath(); g.moveTo(-9, -8); g.quadraticCurveTo(-1, -15, 8, -8); g.stroke();
  },
  saloon(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.rect(-11, -8, 9, 18); g.rect(2, -8, 9, 18); g.stroke();
    g.beginPath(); g.moveTo(-12, -11); g.lineTo(12, -11); g.stroke();
  },
  stagecoach(g) { pipRing(g, 11); pipRing(g, 4); g.lineWidth = 1.4;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 7; g.beginPath();
      g.moveTo(Math.cos(a) * 4, Math.sin(a) * 4); g.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); g.stroke(); } },
  wells(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.rect(-12, -2, 24, 13); g.stroke();
    g.beginPath(); g.moveTo(-12, -2); g.quadraticCurveTo(0, -14, 12, -2); g.stroke();
    g.beginPath(); g.rect(-3, -1, 6, 7); g.stroke();
  },
  store(g) {
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-12, -2); g.lineTo(12, -2); g.moveTo(-12, 11); g.lineTo(12, 11); g.stroke();
    g.beginPath(); g.rect(-9, -11, 6, 9); g.rect(1, -9, 7, 7); g.rect(-4, 2, 8, 9); g.stroke();
  },
  panic(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.rect(0, -12, 11, 16); g.stroke();
    g.beginPath();
    g.moveTo(-12, 12); g.lineTo(-6, 0); g.lineTo(4, 4); g.lineTo(-2, 13); g.closePath(); g.stroke();
  },
  catbalou(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(-12, -12); g.lineTo(-2, -12); g.lineTo(-5, 0); g.lineTo(-1, 12); g.lineTo(-12, 12);
    g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(12, -12); g.lineTo(3, -12); g.lineTo(6, 0); g.lineTo(2, 12); g.lineTo(12, 12);
    g.closePath(); g.stroke();
  },
  indians(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(-13, 8); g.lineTo(-5, -1); g.lineTo(1, 3); g.lineTo(8, -6); g.lineTo(13, 8);
    g.closePath(); g.stroke();
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(0, -8, 5, Math.PI, 0); g.stroke();
  },
  gatling(g) { pipRing(g, 11);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 7 + 0.5; g.lineWidth = 1.6;
      g.beginPath(); g.arc(Math.cos(a) * 6, Math.sin(a) * 6, 2.6, 0, 7); g.stroke(); } },
  duel(g) {
    g.save(); g.rotate(-0.5); g.scale(0.62, 0.62); pipGun(g, 16); g.restore();
    g.save(); g.rotate(Math.PI - 0.5); g.scale(0.62, 0.62); pipGun(g, 16); g.restore();
  },
  barrel(g) {
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(-9, -11); g.lineTo(-11, 11); g.lineTo(11, 11); g.lineTo(9, -11); g.closePath(); g.stroke();
    g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(-10.4, -3); g.lineTo(10.4, -3); g.moveTo(-11, 5); g.lineTo(11, 5); g.stroke();
  },
  scope(g) {
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(-12, -5); g.lineTo(10, -10); g.lineTo(10, 10); g.lineTo(-12, 5); g.closePath(); g.stroke();
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(10, 0); g.lineTo(-12, 0); g.stroke();
  },
  mustang(g) {
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(-4, 12); g.bezierCurveTo(-11, 2, -10, -6, -4, -9);
    g.lineTo(-2, -13); g.lineTo(2, -9); g.lineTo(6, -13); g.lineTo(7, -8);
    g.bezierCurveTo(12, -4, 12, 4, 8, 7); g.lineTo(9, 12);
    g.closePath(); g.stroke();
  },
  jail(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.rect(-11, -11, 22, 22); g.stroke();
    g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(-4, -10); g.lineTo(-4, 10); g.moveTo(4, -10); g.lineTo(4, 10); g.stroke();
  },
  dynamite(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.rect(-8, -4, 16, 16); g.stroke();
    g.beginPath(); g.moveTo(0, -4); g.quadraticCurveTo(7, -10, 2, -14); g.stroke();
    g.beginPath(); g.arc(2, -15, 2.4, 0, 7); g.fill();
  },
  volcanic(g) { g.save(); g.scale(0.85, 0.85); pipGun(g, 10); g.restore(); },
  schofield(g) { pipGun(g, 13); },
  remington(g) { pipGun(g, 15); },
  carabine(g) { g.save(); g.scale(0.9, 0.9); pipGun(g, 17); g.restore(); },
  winchester(g) { g.save(); g.scale(0.82, 0.82); pipGun(g, 20); g.restore(); },
};

/** Which of the eighty this press can print. Checked against the deck by a test. */
export const PRINTABLE = Object.keys(CUT).filter((id) => PIP[id] && FIT[id]);

/**
 * One of the eighty as an <img>-ready data URL, printed on first use and kept
 * for the session. Same plate, same paper and same WebP economy as the six.
 */
export function duelCardUrl(id) {
  const def = DUEL_CARDS[id];
  if (!def || !CUT[id]) return '';
  return plateUrl(`duel:${id}`, () => plate({
    id: `duel:${id}`, name: def.name, rules: def.rules, flavour: def.flavour,
    cut: CUT[id], pip: PIP[id], fit: FIT[id],
  }));
}
