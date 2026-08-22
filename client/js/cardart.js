// The Deck, printed.
//
// Same rule as the rest of this project: there are no art assets anywhere, so
// every card face below is drawn at runtime onto a canvas. The goal is not a
// clean vector icon - it is a piece of cheap 1880s job printing: rag paper that
// has been in somebody's coat pocket, a wood-engraved cut, and letterpress ink
// that did not take evenly.
//
// The three things that actually sell it:
//   1. the ink is drawn on its own layer, eroded with hundreds of tiny holes,
//      then composited onto the paper with 'multiply' - so paper grain shows
//      THROUGH the ink instead of sitting on top of it,
//   2. a faint mis-registered red plate under the black one, the way a
//      two-colour press drifts,
//   3. every card is seeded from its own id, so a given card is always the same
//      physical object and never shimmers between redraws.

const W = 600, H = 840;                 // 5:7, near enough to a real card
const INK = '#241a12';
const cache = new Map();

// ---------------------------------------------------------------------------
// Seeded noise, so a card is an object and not a lottery
// ---------------------------------------------------------------------------
function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Trim the card to a rounded corner and rough the cut edge a little. */
function trim(c, R) {
  const g = c.getContext('2d');
  const r = 26;
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = '#000';
  g.beginPath();
  g.moveTo(r, 0);
  g.arcTo(W, 0, W, H, r); g.arcTo(W, H, 0, H, r);
  g.arcTo(0, H, 0, 0, r); g.arcTo(0, 0, W, 0, r);
  g.closePath();
  g.fill();
  // Nicks along the cut edge - a card that has been shuffled is never crisp.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 150; i++) {
    const onX = R() < 0.5;
    const x = onX ? R() * W : (R() < 0.5 ? 0 : W);
    const y = onX ? (R() < 0.5 ? 0 : H) : R() * H;
    g.globalAlpha = 0.3 + R() * 0.7;
    g.beginPath(); g.arc(x, y, 1 + R() * 4.5, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return c;
}

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------
function paper(g, R) {
  const base = g.createLinearGradient(0, 0, W * 0.6, H);
  base.addColorStop(0, '#f2e7cd');
  base.addColorStop(0.45, '#ecdfc0');
  base.addColorStop(1, '#e2d2ae');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  // Uneven pulp: broad soft blotches, some lighter, some darker.
  for (let i = 0; i < 46; i++) {
    const x = R() * W, y = R() * H, r = 60 + R() * 190;
    const dark = R() < 0.55;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, dark ? 'rgba(150,120,78,0.075)' : 'rgba(255,248,228,0.10)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Rag fibres.
  g.lineWidth = 1;
  for (let i = 0; i < 1500; i++) {
    const x = R() * W, y = R() * H, a = R() * Math.PI, len = 2 + R() * 11;
    g.strokeStyle = R() < 0.5 ? `rgba(120,96,60,${R() * 0.11})` : `rgba(255,250,232,${R() * 0.16})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  // Foxing: the little rust freckles old paper grows.
  for (let i = 0; i < 90; i++) {
    const x = R() * W, y = R() * H, r = 1 + R() * 5.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(142,96,44,${0.1 + R() * 0.2})`);
    gr.addColorStop(1, 'rgba(142,96,44,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // One old ring from a glass somebody set down on it.
  const rx = 90 + R() * 420, ry = 120 + R() * 600, rr = 78 + R() * 46;
  g.strokeStyle = 'rgba(126,82,38,0.10)';
  g.lineWidth = 6 + R() * 5;
  g.beginPath(); g.arc(rx, ry, rr, R() * 2, R() * 2 + 3.4 + R()); g.stroke();

  // Handled edges: darker where thumbs go, plus a soft vertical crease.
  const edge = (x0, y0, x1, y1) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(108,80,44,0.30)');
    gr.addColorStop(0.35, 'rgba(108,80,44,0.06)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  };
  edge(0, 0, 46, 0); edge(W, 0, W - 46, 0); edge(0, 0, 0, 46); edge(0, H, 0, H - 46);

  const crease = g.createLinearGradient(W * 0.5 - 14, 0, W * 0.5 + 14, 0);
  crease.addColorStop(0, 'rgba(255,252,240,0)');
  crease.addColorStop(0.42, 'rgba(120,92,52,0.10)');
  crease.addColorStop(0.5, 'rgba(255,252,240,0.16)');
  crease.addColorStop(1, 'rgba(255,252,240,0)');
  g.fillStyle = crease;
  g.fillRect(W * 0.5 - 14, 0, 28, H);

  // Grain.
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = `rgba(${R() < 0.5 ? '90,70,42' : '255,250,236'},${R() * 0.10})`;
    g.fillRect(R() * W, R() * H, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// Ink: drawn apart, worn down, then pressed into the paper
// ---------------------------------------------------------------------------
function press(target, drawInk, R) {
  const plate = mk(W, H);
  const g = plate.getContext('2d');
  g.strokeStyle = INK; g.fillStyle = INK;
  g.lineCap = 'round'; g.lineJoin = 'round';
  drawInk(g);

  // Wear: punch a few hundred holes so the impression is never solid.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) {
    g.globalAlpha = 0.18 + R() * 0.7;
    g.beginPath();
    g.arc(R() * W, R() * H, 0.35 + R() * 2.3, 0, 7);
    g.fill();
  }
  // ...heaviest at the edges, where a pocketed card rubs.
  for (let i = 0; i < 260; i++) {
    const onX = R() < 0.5;
    const x = onX ? R() * W : (R() < 0.5 ? R() * 40 : W - R() * 40);
    const y = onX ? (R() < 0.5 ? R() * 40 : H - R() * 40) : R() * H;
    g.globalAlpha = 0.4 + R() * 0.6;
    g.beginPath(); g.arc(x, y, 1 + R() * 5, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  const t = target;
  // The red plate the press never quite lined up.
  t.save();
  t.globalCompositeOperation = 'multiply';
  t.globalAlpha = 0.16;
  t.filter = 'sepia(1) saturate(6) hue-rotate(-18deg)';
  t.drawImage(plate, 2.2, 1.4);
  t.filter = 'none';
  // Then the black, twice: a soft bleed under a firmer impression.
  t.globalAlpha = 0.3;
  t.drawImage(plate, -0.7, 0.5);
  t.globalAlpha = 0.9;
  t.drawImage(plate, 0, 0);
  t.restore();
}

// ---------------------------------------------------------------------------
// Engraving helpers
// ---------------------------------------------------------------------------
/** Fill a shape with parallel rules - the whole vocabulary of a wood cut. */
function hatch(g, shape, angle, gap, lw = 1.6, alpha = 1) {
  g.save();
  g.beginPath(); shape(g); g.clip();
  g.globalAlpha = alpha;
  g.lineWidth = lw;
  g.translate(W / 2, H / 2);
  g.rotate(angle);
  const far = W + H;
  g.beginPath();
  for (let x = -far; x < far; x += gap) { g.moveTo(x, -far); g.lineTo(x, far); }
  g.stroke();
  g.restore();
}

/** Small caps with real letterspacing, since canvas has no letter-spacing. */
function spaced(g, text, cx, y, size, track, weight = 'bold', family = 'Georgia, "Times New Roman", serif') {
  g.save();
  g.font = `${weight} ${size}px ${family}`;
  // Canvas has real letter-spacing in every browser this game runs in, and it
  // keeps the kerning pairs; drawing glyph by glyph does not, and display type
  // at this size shows every bad pair as a hole (RA IN BARREL).
  if ('letterSpacing' in g) {
    g.letterSpacing = `${track}px`;
    const align = g.textAlign;
    g.textAlign = 'center';
    g.fillText(text, cx + track / 2, y);
    g.textAlign = align;
    const w = g.measureText(text).width;
    g.restore();
    return w;
  }
  const chars = [...text];
  const total = chars.reduce((w, c) => w + g.measureText(c).width + track, -track);
  let x = cx - total / 2;
  for (const c of chars) {
    g.fillText(c, x, y);
    x += g.measureText(c).width + track;
  }
  g.restore();
  return total;
}

function wrap(g, text, cx, y, maxW, lh, size, style = '') {
  g.save();
  g.font = `${style} ${size}px Georgia, "Times New Roman", serif`;
  g.textAlign = 'center';
  const words = text.split(' ');
  let line = '', n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, cx, y + n * lh); n++; line = w;
    } else line = test;
  }
  if (line) { g.fillText(line, cx, y + n * lh); n++; }
  g.restore();
  return n;
}

/** Double rule with cut corners and a printer's ornament at each one. */
function frame(g) {
  const m = 30, n = 42;
  g.lineWidth = 4.5;
  g.strokeRect(m, m, W - m * 2, H - m * 2);
  g.lineWidth = 1.4;
  g.strokeRect(n, n, W - n * 2, H - n * 2);
  for (const [x, y] of [[n, n], [W - n, n], [n, H - n], [W - n, H - n]]) {
    g.save();
    g.translate(x, y);
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
    }
    g.closePath();
    g.fill();
    g.restore();
  }
}

// ---------------------------------------------------------------------------
// The six cuts
// ---------------------------------------------------------------------------
const CUT = {
  // A water barrel with a fresh hole in it, still spouting.
  barrel(g, R) {
    const cx = 300, top = 268, bot = 566, hw = 116;
    const side = (s) => (t) => cx + s * (hw - 18 * Math.sin(t * Math.PI) * -1) * 1;
    // Staves: bulging sides.
    const body = (c) => {
      c.moveTo(cx - hw + 16, top);
      c.bezierCurveTo(cx - hw - 12, top + 100, cx - hw - 12, bot - 100, cx - hw + 20, bot);
      c.lineTo(cx + hw - 20, bot);
      c.bezierCurveTo(cx + hw + 12, bot - 100, cx + hw + 12, top + 100, cx + hw - 16, top);
      c.closePath();
    };
    g.lineWidth = 3.4;
    g.beginPath(); body(g); g.stroke();

    // Shading down the left flank and under the belly.
    hatch(g, (c) => { body(c); }, 0.28, 7, 1.5, 0.55);
    g.save();
    g.beginPath(); body(g); g.clip();
    g.fillStyle = 'rgba(255,255,255,1)';
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(cx - 58, top - 20, 200, H);          // keep the lit side clean
    g.restore();

    // Stave joints.
    g.lineWidth = 1.5;
    for (let i = -3; i <= 3; i++) {
      const x = cx + i * 32;
      g.beginPath();
      g.moveTo(x + i * 2.4, top + 6);
      g.bezierCurveTo(x + i * 4, top + 120, x + i * 4, bot - 120, x + i * 2.4, bot - 4);
      g.stroke();
    }
    // Iron hoops.
    for (const [y, h] of [[top + 30, 15], [top + 148, 19], [bot - 44, 17]]) {
      const w = hw + (y > top + 100 && y < bot - 60 ? 12 : 4);
      const hoop = (c) => { c.rect(cx - w, y, w * 2, h); };
      g.save();
      g.beginPath(); body(g); g.clip();
      g.lineWidth = 2.6;
      g.beginPath(); g.rect(cx - w, y, w * 2, h); g.stroke();
      hatch(g, hoop, -0.5, 3.4, 1.3, 0.85);
      g.restore();
    }
    // Rim and the water in it.
    g.lineWidth = 3.2;
    g.beginPath(); g.ellipse(cx, top, hw - 16, 27, 0, 0, 7); g.stroke();
    g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(cx, top + 7, hw - 30, 19, 0, 0, 7); g.stroke();
    for (let i = 0; i < 4; i++) {
      const y = top + 2 + i * 5;
      g.beginPath();
      g.moveTo(cx - 74 + i * 6, y);
      for (let x = -74 + i * 6; x < 74 - i * 6; x += 12) {
        g.quadraticCurveTo(cx + x + 6, y - 3, cx + x + 12, y);
      }
      g.stroke();
    }
    // The hole, and what comes out of it.
    const hx = cx + 44, hy = top + 226;
    g.beginPath(); g.arc(hx, hy, 7, 0, 7); g.fill();
    g.lineWidth = 2.2;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(hx + 6, hy + i * 2 - 2);
      g.quadraticCurveTo(hx + 96, hy - 10 + i * 5, hx + 150, hy + 92 + i * 9);
      g.stroke();
    }
    for (let i = 0; i < 22; i++) {
      const t = R();
      const x = hx + 30 + t * 150 + (R() - 0.5) * 26;
      const y = hy - 6 + t * t * 128 + (R() - 0.5) * 22;
      g.beginPath(); g.arc(x, y, 1 + R() * 3.4, 0, 7); g.fill();
    }
    // Ground.
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - 190, bot + 12); g.lineTo(cx + 190, bot + 4); g.stroke();
    hatch(g, (c) => { c.ellipse(cx + 20, bot + 16, 175, 22, 0, 0, 7); }, 0.1, 6, 1.2, 0.5);
  },

  // A sheet nailed to a plank wall. The face on it is nobody's.
  poster(g, R) {
    // Planks behind.
    g.lineWidth = 1.4;
    for (let x = 96; x < 520; x += 52) {
      g.beginPath(); g.moveTo(x, 248); g.lineTo(x - 4, 590); g.stroke();
    }
    hatch(g, (c) => c.rect(96, 248, 424, 342), -0.14, 11, 1, 0.30);

    // The sheet, tacked crooked, torn along the bottom.
    g.save();
    g.translate(300, 415);
    g.rotate(-0.045);
    const w = 168, h = 220;
    const sheet = (c) => {
      c.moveTo(-w, -h); c.lineTo(w, -h + 6); c.lineTo(w - 3, h - 26);
      for (let x = w - 3; x > -w; x -= 22) {
        c.lineTo(x - 11, h - 26 + (R() - 0.5) * 30);
        c.lineTo(x - 22, h - 26 + (R() - 0.5) * 24);
      }
      c.closePath();
    };
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); sheet(g); g.fill();            // knock the plank hatching out
    g.restore();
    g.lineWidth = 3;
    g.beginPath(); sheet(g); g.stroke();

    g.textAlign = 'left';
    spaced(g, 'WANTED', 0, -h + 62, 54, 5);
    g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(-w + 22, -h + 82); g.lineTo(w - 22, -h + 82); g.stroke();

    // An oval portrait with nobody in it - just an engraved blank.
    const oval = (c) => c.ellipse(0, -14, 74, 90, 0, 0, 7);
    g.lineWidth = 3;
    g.beginPath(); oval(g); g.stroke();
    hatch(g, oval, 0.7, 5.5, 1.4, 0.75);
    hatch(g, oval, -0.7, 9, 1.1, 0.5);
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.ellipse(-16, -44, 40, 46, 0.3, 0, 7); g.fill();
    g.restore();
    g.lineWidth = 2;
    g.beginPath(); oval(g); g.stroke();

    spaced(g, 'DEAD OR ALIVE', 0, 118, 20, 3, 'normal');
    g.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const y = 138 + i * 14;
      g.beginPath(); g.moveTo(-w + 34 + i * 12, y); g.lineTo(w - 34 - i * 16, y); g.stroke();
    }
    g.restore();

    // The nail, driven through the top.
    g.beginPath(); g.arc(300, 214, 9, 0, 7); g.fill();
    g.lineWidth = 2;
    g.beginPath(); g.arc(300, 214, 14, 0, 7); g.stroke();
    hatch(g, (c) => c.ellipse(300, 236, 26, 12, 0, 0, 7), 0.2, 4, 1.1, 0.45);
  },

  // Boot prints, and the blanket dragging them out of existence.
  tracks(g, R) {
    const boot = (x, y, s, a) => {
      g.save();
      g.translate(x, y); g.rotate(a); g.scale(s, s);
      const sole = (c) => {
        c.moveTo(-30, -54);
        c.bezierCurveTo(-40, -8, -35, 24, -23, 35);
        c.lineTo(23, 35);
        c.bezierCurveTo(35, 24, 40, -8, 30, -54);
        c.bezierCurveTo(16, -70, -16, -70, -30, -54);
        c.closePath();
      };
      const heel = (c) => { c.ellipse(0, 62, 29, 26, 0, 0, 7); };
      g.lineWidth = 3.4;
      g.beginPath(); sole(g); g.stroke();
      g.beginPath(); heel(g); g.stroke();
      hatch(g, sole, 0.55, 5, 1.5, 0.85);
      hatch(g, heel, -0.55, 5, 1.5, 0.85);
      g.save();                                   // tread bars, cut back out
      g.globalCompositeOperation = 'destination-out';
      g.lineWidth = 4;
      for (let i = 0; i < 5; i++) {
        g.beginPath(); g.moveTo(-28, -40 + i * 17); g.lineTo(28, -40 + i * 17); g.stroke();
      }
      g.beginPath(); g.moveTo(-24, 62); g.lineTo(24, 62); g.stroke();
      g.restore();
      g.lineWidth = 3.4;
      g.beginPath(); sole(g); g.stroke();
      g.beginPath(); heel(g); g.stroke();
      g.restore();
    };
    // Walking away from the viewer, up the street.
    boot(196, 604, 1.05, -0.16);
    boot(272, 470, 0.86, 0.12);
    boot(330, 366, 0.70, -0.08);
    boot(376, 288, 0.56, 0.14);

    // The blanket comes across and takes the older half of the trail with it.
    const band = (c) => {
      c.moveTo(74, 384);
      c.bezierCurveTo(216, 286, 400, 308, 534, 414);
      c.lineTo(528, 502);
      c.bezierCurveTo(396, 394, 220, 372, 78, 466);
      c.closePath();
    };
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); band(g); g.fill();             // literally wipes the prints out
    g.restore();
    g.lineWidth = 3.4;
    g.beginPath(); band(g); g.stroke();
    hatch(g, band, 1.15, 7, 1.4, 0.5);
    // Folds in the cloth.
    g.lineWidth = 1.8;
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const x = 78 + t * 452;
      g.beginPath();
      g.moveTo(x, 384 - 96 * Math.sin(t * 3.14) + 6);
      g.lineTo(x + 8, 466 - 92 * Math.sin(t * 3.14));
      g.stroke();
    }
    // The rope somebody is dragging it by.
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(76, 400); g.bezierCurveTo(44, 350, 52, 282, 100, 234);
    g.stroke();
    g.lineWidth = 1.6;
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const x = 76 - 30 * Math.sin(t * 2.1) + t * 20;
      const y = 400 - t * 166;
      g.beginPath(); g.moveTo(x - 7, y); g.lineTo(x + 7, y - 5); g.stroke();
    }
    // Dust thrown off the drag.
    for (let i = 0; i < 130; i++) {
      const t = R();
      const x = 78 + t * 456 + (R() - 0.5) * 34;
      const y = 384 - 104 * Math.sin(t * 3.14) - R() * 92;
      g.globalAlpha = 0.2 + R() * 0.65;
      g.beginPath(); g.arc(x, y, 0.8 + R() * 3.4, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    // Ground line, so the trail sits on something.
    g.lineWidth = 1.6;
    g.globalAlpha = 0.55;
    for (let i = 0; i < 4; i++) {
      const y = 640 + i * 8;
      g.beginPath();
      g.moveTo(80 + i * 30, y);
      g.bezierCurveTo(220, y - 10, 360, y + 8, 520 - i * 26, y - 4);
      g.stroke();
    }
    g.globalAlpha = 1;
  },

  // A silver dollar held over an eye. Nobody in this town saw anything.
  witness(g, R) {
    const ex = 250, ey = 400, ew = 178, eh = 88;
    const eye = (c) => {
      c.moveTo(ex - ew, ey);
      c.bezierCurveTo(ex - ew + 46, ey - eh - 18, ex + ew - 46, ey - eh - 18, ex + ew, ey);
      c.bezierCurveTo(ex + ew - 46, ey + eh + 12, ex - ew + 46, ey + eh + 12, ex - ew, ey);
      c.closePath();
    };
    g.lineWidth = 4.5;
    g.beginPath(); eye(g); g.stroke();
    hatch(g, eye, 0.62, 11, 1.3, 0.4);
    g.save();                                     // the white stays white
    g.beginPath(); eye(g); g.clip();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.ellipse(ex, ey - 6, 118, 52, 0, 0, 7); g.fill();
    g.restore();

    const iris = (c) => c.arc(ex, ey - 2, 64, 0, 7);
    g.lineWidth = 3.4;
    g.beginPath(); iris(g); g.stroke();
    g.lineWidth = 1.5;
    for (let i = 0; i < 52; i++) {
      const a = (i / 52) * Math.PI * 2;
      const r0 = 26 + (i % 3) * 5;
      g.beginPath();
      g.moveTo(ex + Math.cos(a) * r0, ey - 2 + Math.sin(a) * r0);
      g.lineTo(ex + Math.cos(a) * 63, ey - 2 + Math.sin(a) * 63);
      g.stroke();
    }
    g.beginPath(); g.arc(ex, ey - 2, 26, 0, 7); g.fill();
    g.save();                                     // catchlight
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(ex - 13, ey - 17, 8, 0, 7); g.fill();
    g.restore();

    // Lashes right along the lid, and a brow over the whole thing.
    g.lineWidth = 3.4;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = ex - ew + 12 + t * (ew * 2 - 24);
      const y = ey - (eh + 4) * Math.sin(t * Math.PI) - 2;
      const lean = (t - 0.5) * 40;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + lean, y - 22 - Math.sin(t * Math.PI) * 20);
      g.stroke();
    }
    const brow = (c) => {
      c.moveTo(ex - ew - 26, ey - 118);
      c.bezierCurveTo(ex - 80, ey - 196, ex + 80, ey - 196, ex + ew + 20, ey - 122);
      c.lineTo(ex + ew + 4, ey - 154);
      c.bezierCurveTo(ex + 76, ey - 224, ex - 76, ey - 224, ex - ew - 16, ey - 150);
      c.closePath();
    };
    g.lineWidth = 3;
    g.beginPath(); brow(g); g.stroke();
    hatch(g, brow, -0.42, 5.5, 1.5, 0.9);

    // The dollar, set over the outer half of the eye so both still read.
    const cx = 400, cy = 408, cr = 94;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(cx, cy, cr + 4, 0, 7); g.fill();
    g.restore();
    g.lineWidth = 4.5;
    g.beginPath(); g.arc(cx, cy, cr, 0, 7); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, cr - 12, 0, 7); g.stroke();
    g.beginPath(); g.arc(cx, cy, cr - 19, 0, 7); g.stroke();
    for (let i = 0; i < 88; i++) {                // milled edge
      const a = (i / 88) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (cr - 11), cy + Math.sin(a) * (cr - 11));
      g.lineTo(cx + Math.cos(a) * (cr - 1), cy + Math.sin(a) * (cr - 1));
      g.stroke();
    }
    // Struck silver: dense hatching from the lower left, blank where the light is.
    hatch(g, (c) => c.arc(cx, cy, cr - 21, 0, 7), -0.6, 6, 1.5, 0.85);
    g.save();
    g.beginPath(); g.arc(cx, cy, cr - 21, 0, 7); g.clip();
    g.globalCompositeOperation = 'destination-out';
    const lit = g.createLinearGradient(cx - cr, cy + cr, cx + cr * 0.4, cy - cr);
    lit.addColorStop(0, 'rgba(0,0,0,0)');
    lit.addColorStop(0.55, 'rgba(0,0,0,1)');
    lit.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = lit;
    g.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
    g.fillStyle = INK;
    g.restore();
    // Legend around the rim, as marks rather than letters - it is a prop.
    g.lineWidth = 2.4;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 - 0.2;
      const r = cr - 15.5;
      g.beginPath();
      g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.1, 0, 7);
      g.stroke();
    }

    // Two fingers, coming in from off the card to pinch the rim.
    g.lineWidth = 3.8;
    for (const [oy, w, tip] of [[-46, 40, 22], [26, 44, 24]]) {
      const fy = cy + oy;
      const finger = (c) => {
        c.moveTo(cx + cr - 26, fy - w / 2);
        c.lineTo(600, fy - w / 2 - 12);
        c.lineTo(600, fy + w / 2 + 14);
        c.lineTo(cx + cr - 26, fy + w / 2);
        c.bezierCurveTo(cx + cr - 26 - tip, fy + w / 2 - 4, cx + cr - 26 - tip, fy - w / 2 + 4, cx + cr - 26, fy - w / 2);
        c.closePath();
      };
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); finger(g); g.fill();
      g.restore();
      g.beginPath(); finger(g); g.stroke();
      hatch(g, finger, 0.4, 9, 1.4, 0.4);
      g.lineWidth = 2.2;                          // knuckle
      g.beginPath();
      g.moveTo(cx + cr + 44, fy - w / 2 - 4);
      g.quadraticCurveTo(cx + cr + 52, fy, cx + cr + 44, fy + w / 2 + 6);
      g.stroke();
      g.lineWidth = 3.8;
    }
  },

  // The undertaker's book, open at today's page.
  ledger(g, R) {
    const cx = 300, cy = 420;
    g.lineWidth = 3.6;
    const page = (s) => (c) => {
      c.moveTo(cx, cy - 96);
      c.bezierCurveTo(cx + s * 60, cy - 118, cx + s * 150, cy - 122, cx + s * 208, cy - 100);
      c.lineTo(cx + s * 196, cy + 106);
      c.bezierCurveTo(cx + s * 140, cy + 84, cx + s * 56, cy + 88, cx, cy + 108);
      c.closePath();
    };
    for (const s of [-1, 1]) {
      g.beginPath(); page(s)(g); g.stroke();
      // The block of leaves under the open page.
      g.lineWidth = 1.6;
      for (let i = 1; i <= 5; i++) {
        g.beginPath();
        g.moveTo(cx + s * 208 - s * 2, cy - 100 + i * 4);
        g.bezierCurveTo(cx + s * 150, cy - 122 + i * 5, cx + s * 60, cy - 118 + i * 5, cx, cy - 96 + i * 4);
        g.stroke();
      }
      g.lineWidth = 3.6;
    }
    // Spine.
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, cy - 96); g.lineTo(cx, cy + 108); g.stroke();
    hatch(g, (c) => { c.rect(cx - 12, cy - 100, 24, 210); }, 0, 4, 1.2, 0.5);

    // Ruled lines, and names written on them.
    g.lineWidth = 1.3;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        const y = cy - 66 + i * 22;
        g.globalAlpha = 0.55;
        g.beginPath();
        g.moveTo(cx + s * 18, y + s * 2);
        g.bezierCurveTo(cx + s * 90, y - 8, cx + s * 150, y - 8, cx + s * 186, y - 2);
        g.stroke();
        g.globalAlpha = 1;
        // Handwriting: a wobbling line that stops short, like a real entry.
        if (s < 0 || i < 4) {
          const end = 40 + R() * 110;
          g.lineWidth = 2.2;
          g.beginPath();
          g.moveTo(cx + s * 26, y - 4);
          for (let x = 0; x < end; x += 9) {
            g.quadraticCurveTo(
              cx + s * (26 + x + 4), y - 4 - (R() * 12 - 6),
              cx + s * (26 + x + 9), y - 5 - (R() * 5 - 2.5),
            );
          }
          g.stroke();
          g.lineWidth = 1.3;
        }
      }
    }
    // The pen that just wrote one, lying across the page.
    g.save();
    g.translate(cx + 96, cy + 46);
    g.rotate(-0.62);
    g.lineWidth = 3.2;
    const shaft = (c) => {
      c.moveTo(-130, -7); c.lineTo(96, -4); c.lineTo(112, 0); c.lineTo(96, 4); c.lineTo(-130, 7);
      c.closePath();
    };
    g.beginPath(); shaft(g); g.stroke();
    hatch(g, shaft, 0.2, 5, 1.2, 0.55);
    g.beginPath(); g.moveTo(96, -4); g.lineTo(112, 0); g.lineTo(96, 4); g.closePath(); g.fill();
    g.restore();
    hatch(g, (c) => c.ellipse(cx, cy + 132, 210, 26, 0, 0, 7), 0.1, 7, 1.2, 0.4);
  },

  // Brass and glass, and a man firing four hundred yards away.
  spyglass(g, R) {
    g.save();
    g.translate(292, 430);
    g.rotate(-0.34);
    // Three draws, fattest at the objective.
    const tube = (x0, x1, r0, r1) => (c) => {
      c.moveTo(x0, -r0); c.lineTo(x1, -r1); c.lineTo(x1, r1); c.lineTo(x0, r0); c.closePath();
    };
    const draws = [[-186, -58, 21, 27], [-58, 60, 27, 33], [60, 186, 33, 41]];
    for (const [a, b, r0, r1] of draws) {
      g.lineWidth = 3.4;
      g.beginPath(); tube(a, b, r0, r1)(g); g.stroke();
      hatch(g, tube(a, b, r0, r1), 0, 5, 1.5, 0.55);
      g.save();                                   // a hard highlight along the top
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.moveTo(a, -r0 + 4); g.lineTo(b, -r1 + 4); g.lineTo(b, -r1 + 14); g.lineTo(a, -r0 + 12);
      g.closePath(); g.fill();
      g.restore();
      // Collar at the joint.
      g.lineWidth = 3;
      g.beginPath(); g.rect(b - 9, -r1 - 3, 18, r1 * 2 + 6); g.stroke();
      hatch(g, (c) => c.rect(b - 9, -r1 - 3, 18, r1 * 2 + 6), 1.2, 3.4, 1.2, 0.8);
    }
    // Eyepiece.
    g.lineWidth = 3.4;
    g.beginPath(); g.rect(-206, -25, 22, 50); g.stroke();
    hatch(g, (c) => c.rect(-206, -25, 22, 50), 1.4, 3.6, 1.3, 0.7);
    g.beginPath(); g.ellipse(-206, 0, 6, 25, 0, 0, 7); g.stroke();
    // Objective lens.
    g.lineWidth = 3.4;
    g.beginPath(); g.ellipse(186, 0, 8, 41, 0, 0, 7); g.stroke();
    hatch(g, (c) => c.ellipse(186, 0, 8, 41, 0, 0, 7), 0.9, 4, 1.2, 0.6);
    g.restore();

    // What it is pointed at: a circle of ground four hundred yards off.
    const vx = 428, vy = 274, vr = 96;
    g.lineWidth = 4;
    g.beginPath(); g.arc(vx, vy, vr, 0, 7); g.stroke();
    g.lineWidth = 1.4;
    g.beginPath(); g.arc(vx, vy, vr - 9, 0, 7); g.stroke();
    g.save();
    g.beginPath(); g.arc(vx, vy, vr - 11, 0, 7); g.clip();
    // Horizon and mesa.
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(vx - vr, vy + 34); g.lineTo(vx + vr, vy + 30); g.stroke();
    g.beginPath();
    g.moveTo(vx - 96, vy + 12); g.lineTo(vx - 54, vy - 14); g.lineTo(vx - 10, vy - 12);
    g.lineTo(vx + 6, vy + 14);
    g.stroke();
    hatch(g, (c) => { c.rect(vx - vr, vy + 30, vr * 2, vr); }, 0.15, 7, 1.2, 0.45);
    // A figure, mid-shot.
    g.lineWidth = 3.2;
    const fx = vx + 26, fy = vy + 30;
    g.beginPath(); g.arc(fx, fy - 42, 8, 0, 7); g.fill();
    g.beginPath(); g.moveTo(fx, fy - 34); g.lineTo(fx - 3, fy); g.stroke();
    g.beginPath(); g.moveTo(fx - 3, fy); g.lineTo(fx - 13, fy + 22); g.moveTo(fx - 3, fy); g.lineTo(fx + 9, fy + 22); g.stroke();
    g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(fx - 2, fy - 26); g.lineTo(fx + 30, fy - 32); g.stroke();
    // Muzzle flash.
    g.lineWidth = 2.2;
    for (let i = 0; i < 11; i++) {
      const a = -0.2 + (i / 10 - 0.5) * 1.5;
      const len = 12 + R() * 22;
      g.beginPath();
      g.moveTo(fx + 31, fy - 32);
      g.lineTo(fx + 31 + Math.cos(a) * len, fy - 32 + Math.sin(a) * len);
      g.stroke();
    }
    // Crosshair.
    g.lineWidth = 1.6;
    g.globalAlpha = 0.7;
    g.beginPath();
    g.moveTo(vx - vr + 14, vy); g.lineTo(vx + vr - 14, vy);
    g.moveTo(vx, vy - vr + 14); g.lineTo(vx, vy + vr - 14);
    g.stroke();
    g.globalAlpha = 1;
    g.restore();
    // Rays, so the circle reads as "through the glass".
    g.lineWidth = 1.6;
    g.globalAlpha = 0.5;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(352 + i * 5, 372 - i * 4);
      g.lineTo(330 + i * 6, 400 - i * 5);
      g.stroke();
    }
    g.globalAlpha = 1;
  },
};

// Each cut is drawn in its own comfortable coordinates; this puts them all in
// the same window on the card so no face looks like it was set by a different
// printer. Numbers are eyeballed against the proof sheet, which is the only way
// this kind of thing is ever done.
const WIN = { x: 74, y: 196, w: 452, h: 410 };     // the picture window
const FIT = {
  barrel:   { s: 1.12, x: 6, y: -6 },
  poster:   { s: 0.95, x: 0, y: -6 },
  tracks:   { s: 0.84, x: -2, y: -22 },
  witness:  { s: 0.92, x: -18, y: 40 },
  ledger:   { s: 1.06, x: 0, y: -26 },
  spyglass: { s: 0.95, x: -6, y: 10 },
};

// Corner marks: a tiny cut of the same motif, so a card is identifiable at a
// glance from an inch of it - which is all you see of one in a fanned hand.
const PIP = {
  barrel(g) {
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(-9, -11); g.lineTo(-11, 11); g.lineTo(11, 11); g.lineTo(9, -11); g.closePath(); g.stroke();
    g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(-10.4, -3); g.lineTo(10.4, -3); g.moveTo(-11, 5); g.lineTo(11, 5); g.stroke();
  },
  poster(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.rect(-9, -12, 18, 24); g.stroke();
    g.beginPath(); g.arc(0, -12, 2.6, 0, 7); g.fill();
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(-5, -3); g.lineTo(5, -3); g.moveTo(-5, 3); g.lineTo(5, 3); g.stroke();
  },
  tracks(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(0, -4, 7, 10, 0, 0, 7); g.stroke();
    g.beginPath(); g.ellipse(0, 10, 5.5, 4.5, 0, 0, 7); g.stroke();
  },
  witness(g) {
    g.lineWidth = 2.2;
    g.beginPath(); g.arc(0, 0, 11, 0, 7); g.stroke();
    g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
  },
  ledger(g) {
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(0, -9); g.quadraticCurveTo(7, -12, 12, -9); g.lineTo(12, 10);
    g.quadraticCurveTo(7, 7, 0, 10);
    g.quadraticCurveTo(-7, 7, -12, 10); g.lineTo(-12, -9);
    g.quadraticCurveTo(-7, -12, 0, -9);
    g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 10); g.stroke();
  },
  spyglass(g) {
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(-12, -5); g.lineTo(12, -9); g.lineTo(12, 9); g.lineTo(-12, 5); g.closePath();
    g.stroke();
  },
};

// ---------------------------------------------------------------------------
// The press run
// ---------------------------------------------------------------------------
function printFace(id, def) {
  const R = rng(seedOf(id));
  const c = mk(W, H);
  const g = c.getContext('2d');
  paper(g, R);

  press(g, (k) => {
    frame(k);
    k.textAlign = 'center';
    k.textBaseline = 'alphabetic';

    // Title, broken over two lines when the name is long.
    const words = def.name.toUpperCase().split(' ');
    const lines = words.length > 2 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : [def.name.toUpperCase()];
    let ty = lines.length > 1 ? 122 : 142;
    for (const line of lines) {
      const size = line.length > 13 ? 40 : 47;
      spaced(k, line, W / 2, ty, size, 4.5);
      ty += 50;
    }
    k.lineWidth = 2.2;
    k.beginPath(); k.moveTo(112, 176); k.lineTo(W - 112, 176); k.stroke();
    k.beginPath(); k.moveTo(W / 2 - 5, 172); k.lineTo(W / 2, 166); k.lineTo(W / 2 + 5, 172);
    k.lineTo(W / 2, 178); k.closePath(); k.fill();

    // The cut, dropped into the card's picture window.
    const f = FIT[id];
    k.save();
    k.beginPath(); k.rect(WIN.x, WIN.y, WIN.w, WIN.h); k.clip();
    k.translate(300 + f.x, 400 + f.y);
    k.scale(f.s, f.s);
    k.translate(-300, -400);
    CUT[id](k, R);
    k.restore();

    // Rules text, in the small print at the foot of the card.
    k.beginPath(); k.moveTo(96, 622); k.lineTo(W - 96, 622); k.stroke();
    const n = wrap(k, def.rules, W / 2, 658, 424, 28, 21);
    k.save();
    k.globalAlpha = 0.72;
    wrap(k, def.flavour, W / 2, 668 + n * 27, 400, 22, 17, 'italic');
    k.restore();

    // Corner marks, one upright and one turned, like a real index.
    for (const [x, y, rot] of [[62, 62, 0], [W - 62, H - 62, Math.PI]]) {
      k.save(); k.translate(x, y); k.rotate(rot); PIP[id](k); k.restore();
    }
  }, R);

  return trim(c, R);
}

function printBack() {
  const R = rng(seedOf('back'));
  const c = mk(W, H);
  const g = c.getContext('2d');
  paper(g, R);
  press(g, (k) => {
    k.lineWidth = 4.5;
    k.strokeRect(26, 26, W - 52, H - 52);
    k.lineWidth = 1.4;
    k.strokeRect(38, 38, W - 76, H - 76);
    // Diamond lattice.
    k.save();
    k.beginPath(); k.rect(38, 38, W - 76, H - 76); k.clip();
    k.lineWidth = 1.5;
    k.globalAlpha = 0.62;
    for (let i = -H; i < W + H; i += 26) {
      k.beginPath(); k.moveTo(i, 0); k.lineTo(i + H, H); k.stroke();
      k.beginPath(); k.moveTo(i, H); k.lineTo(i + H, 0); k.stroke();
    }
    k.globalAlpha = 1;
    // Medallion: a sun going down behind a mesa.
    k.globalCompositeOperation = 'destination-out';
    k.beginPath(); k.arc(W / 2, H / 2, 128, 0, 7); k.fill();
    k.globalCompositeOperation = 'source-over';
    k.lineWidth = 4;
    k.beginPath(); k.arc(W / 2, H / 2, 122, 0, 7); k.stroke();
    k.lineWidth = 1.6;
    k.beginPath(); k.arc(W / 2, H / 2, 112, 0, 7); k.stroke();
    k.save();
    k.beginPath(); k.arc(W / 2, H / 2, 110, 0, 7); k.clip();
    k.lineWidth = 3;
    k.beginPath(); k.arc(W / 2, H / 2 + 26, 54, Math.PI, 0); k.stroke();
    for (let i = 0; i < 16; i++) {
      const a = Math.PI + (i / 15) * Math.PI;
      k.beginPath();
      k.moveTo(W / 2 + Math.cos(a) * 62, H / 2 + 26 + Math.sin(a) * 62);
      k.lineTo(W / 2 + Math.cos(a) * (74 + (i % 2) * 14), H / 2 + 26 + Math.sin(a) * (74 + (i % 2) * 14));
      k.stroke();
    }
    const mesa = (c) => {
      c.moveTo(W / 2 - 130, H / 2 + 30);
      c.lineTo(W / 2 - 74, H / 2 - 4); c.lineTo(W / 2 - 26, H / 2 - 1);
      c.lineTo(W / 2 + 22, H / 2 + 30);
      c.lineTo(W / 2 + 130, H / 2 + 30);
      c.lineTo(W / 2 + 130, H / 2 + 130); c.lineTo(W / 2 - 130, H / 2 + 130);
      c.closePath();
    };
    k.lineWidth = 4;
    k.beginPath(); mesa(k); k.stroke();
    hatch(k, mesa, 0.22, 5, 1.6, 0.9);
    hatch(k, mesa, -0.6, 9, 1.2, 0.5);
    k.restore();
    k.restore();
  }, R);
  return trim(c, R);
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
let DEFS = {};

/** Hand the module the card table once, so it can letter the faces. */
export function useDefs(defs) { DEFS = defs; }

export function cardCanvas(id) {
  if (cache.has(id)) return cache.get(id);
  const c = id === 'back' ? printBack() : printFace(id, DEFS[id]);
  cache.set(id, c);
  return c;
}

/**
 * A card as an <img>-ready data URL, printed on first use and kept.
 *
 * WebP because a face is mostly paper grain: the same card is ~1.4MB as a PNG
 * and ~130KB as WebP, and the deck is held in memory for the whole session.
 * Alpha survives, so the trimmed corners still work. Anything that cannot
 * encode WebP falls back to PNG rather than shipping a broken src.
 */
export function cardUrl(id) {
  const key = `url:${id}`;
  if (cache.has(key)) return cache.get(key);
  const c = cardCanvas(id);
  let url = '';
  try { url = c.toDataURL('image/webp', 0.92); } catch { url = ''; }
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
  cache.set(key, url);
  // The plate has been run; from here the card only ever exists as an image.
  cache.delete(id);
  c.width = c.height = 0;
  return url;
}

export const CARD_W = W;
export const CARD_H = H;

/**
 * Which cards this press can actually print. Exported so a plain Node test can
 * check it against CARD_ORDER - add a card to the deck without cutting a block
 * for it and the suite says so, instead of the game shipping a blank face.
 */
export const PRINTABLE = Object.keys(CUT).filter((id) => PIP[id] && FIT[id]);
