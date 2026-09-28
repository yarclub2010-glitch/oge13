// Иллюстрации для материалов задания 13.1: простая сцена (небо, земля, вода…)
// и крупные значки-эмодзи. Рисуются на canvas и сохраняются в PNG.

const W = 1200;
const H = 900;

// Псевдослучайные числа, чтобы картинка каждый раз получалась одинаковой
function rng(seed) {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function grad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

function sky(ctx, w, h, top, bottom, horizon) {
  ctx.fillStyle = grad(ctx, 0, horizon, [top, bottom]);
  ctx.fillRect(0, 0, w, horizon + 2);
}

function ground(ctx, w, h, y, top, bottom) {
  ctx.fillStyle = grad(ctx, y, h, [top, bottom]);
  ctx.fillRect(0, y, w, h - y);
}

function hills(ctx, w, y, amp, color, rand, count = 4) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, y);
  const step = w / count;
  for (let i = 0; i <= count; i++) {
    const x = i * step;
    ctx.quadraticCurveTo(x - step / 2, y - amp * (0.4 + rand()), x, y);
  }
  ctx.lineTo(w, y + 400);
  ctx.lineTo(0, y + 400);
  ctx.closePath();
  ctx.fill();
}

function sun(ctx, x, y, r, color = '#ffd84d') {
  const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.2);
  g.addColorStop(0, 'rgba(255,240,170,0.9)');
  g.addColorStop(1, 'rgba(255,240,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function cloud(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [dx, dy, r] of [[0, 0, 1], [0.9, -0.3, 1.2], [1.9, 0, 0.9], [0.9, 0.3, 1]]) {
    ctx.beginPath();
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fir(ctx, x, y, h, color = '#1f5a36') {
  ctx.fillStyle = '#5b3a1e';
  ctx.fillRect(x - h * 0.04, y - h * 0.12, h * 0.08, h * 0.12);
  ctx.fillStyle = color;
  for (let k = 0; k < 3; k++) {
    const top = y - h + k * h * 0.22;
    const width = h * (0.22 + k * 0.1);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x - width, top + h * 0.45);
    ctx.lineTo(x + width, top + h * 0.45);
    ctx.closePath();
    ctx.fill();
  }
}

function acacia(ctx, x, y, h) {
  ctx.strokeStyle = '#4a3222';
  ctx.lineWidth = h * 0.05;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h * 0.6);
  ctx.moveTo(x, y - h * 0.45);
  ctx.lineTo(x - h * 0.25, y - h * 0.75);
  ctx.moveTo(x, y - h * 0.5);
  ctx.lineTo(x + h * 0.25, y - h * 0.78);
  ctx.stroke();
  ctx.fillStyle = '#3f6b2a';
  ctx.beginPath();
  ctx.ellipse(x, y - h * 0.82, h * 0.55, h * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
}

function mountains(ctx, w, y, color, snow, rand, peaks = 3) {
  for (let i = 0; i < peaks; i++) {
    const cx = (w / peaks) * (i + 0.5) + (rand() - 0.5) * 120;
    const ph = 220 + rand() * 180;
    const pw = 260 + rand() * 160;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - pw, y);
    ctx.lineTo(cx, y - ph);
    ctx.lineTo(cx + pw, y);
    ctx.closePath();
    ctx.fill();
    if (snow) {
      ctx.fillStyle = snow;
      ctx.beginPath();
      ctx.moveTo(cx, y - ph);
      ctx.lineTo(cx - pw * 0.25, y - ph * 0.75);
      ctx.lineTo(cx - pw * 0.08, y - ph * 0.8);
      ctx.lineTo(cx + pw * 0.05, y - ph * 0.72);
      ctx.lineTo(cx + pw * 0.25, y - ph * 0.75);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function waves(ctx, w, y, h, color, rand) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  for (let k = 0; k < 14; k++) {
    const yy = y + 20 + rand() * (h - y - 30);
    const xx = rand() * w;
    ctx.beginPath();
    ctx.arc(xx, yy, 18, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
}

function stars(ctx, w, h, rand, n = 120) {
  for (let k = 0; k < n; k++) {
    ctx.fillStyle = `rgba(255,255,255,${0.4 + rand() * 0.6})`;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, rand() * 2.2 + 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function volcanoCone(ctx, w, y, night) {
  const cx = w * 0.5;
  ctx.fillStyle = night ? '#2c1f1c' : '#6a4c3b';
  ctx.beginPath();
  ctx.moveTo(cx - 520, y);
  ctx.lineTo(cx - 90, y - 420);
  ctx.lineTo(cx + 90, y - 420);
  ctx.lineTo(cx + 520, y);
  ctx.closePath();
  ctx.fill();
  // лава
  ctx.fillStyle = '#ff5a1f';
  ctx.beginPath();
  ctx.moveTo(cx - 90, y - 420);
  ctx.lineTo(cx - 40, y - 250);
  ctx.lineTo(cx - 70, y - 120);
  ctx.lineTo(cx - 20, y - 180);
  ctx.lineTo(cx + 10, y - 300);
  ctx.lineTo(cx + 90, y - 420);
  ctx.closePath();
  ctx.fill();
  // дым
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = night ? 'rgba(90,70,70,0.7)' : 'rgba(120,110,105,0.75)';
    ctx.beginPath();
    ctx.arc(cx + (k % 2 ? 40 : -30) + k * 25, y - 470 - k * 55, 60 + k * 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,120,40,0.35)';
  ctx.beginPath();
  ctx.arc(cx, y - 430, 110, 0, Math.PI * 2);
  ctx.fill();
}

function pyramid(ctx, x, y, s) {
  ctx.fillStyle = '#d9b36b';
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x, y - s * 0.8);
  ctx.lineTo(x + s, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#b38b4a';
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.8);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x + s * 0.3, y);
  ctx.closePath();
  ctx.fill();
}

const SCENES = {
  savanna(ctx, w, h, r) {
    sky(ctx, w, h, '#f7b267', '#fde4b5', h * 0.62);
    sun(ctx, w * 0.78, h * 0.25, 70, '#fff1b8');
    ground(ctx, w, h, h * 0.62, '#d9a441', '#9c6b25');
    acacia(ctx, w * 0.18, h * 0.66, 300);
    acacia(ctx, w * 0.86, h * 0.64, 220);
  },
  desert(ctx, w, h, r) {
    sky(ctx, w, h, '#7fb8e8', '#f4e2b8', h * 0.6);
    sun(ctx, w * 0.2, h * 0.2, 60);
    ground(ctx, w, h, h * 0.6, '#eacb8a', '#c89a55');
    pyramid(ctx, w * 0.62, h * 0.62, 260);
    pyramid(ctx, w * 0.86, h * 0.62, 170);
  },
  home(ctx, w, h) {
    ctx.fillStyle = grad(ctx, 0, h * 0.7, ['#f3e3cf', '#e6cfb2']);
    ctx.fillRect(0, 0, w, h * 0.7);
    ctx.fillStyle = '#9b6b43';
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
    ctx.fillStyle = '#b98a5f';
    for (let x = 0; x < w; x += 110) ctx.fillRect(x, h * 0.7, 4, h * 0.3);
    ctx.fillStyle = '#bde0f7';
    ctx.fillRect(w * 0.12, h * 0.12, w * 0.3, h * 0.3);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 14;
    ctx.strokeRect(w * 0.12, h * 0.12, w * 0.3, h * 0.3);
    ctx.beginPath();
    ctx.moveTo(w * 0.27, h * 0.12);
    ctx.lineTo(w * 0.27, h * 0.42);
    ctx.stroke();
    ctx.fillStyle = '#c0504d';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.9, w * 0.34, h * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  kitchen(ctx, w, h) {
    SCENES.home(ctx, w, h);
    ctx.fillStyle = '#8a5a35';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
  },
  meadow(ctx, w, h, r) {
    sky(ctx, w, h, '#6fb7ef', '#d7efff', h * 0.58);
    sun(ctx, w * 0.82, h * 0.18, 55);
    cloud(ctx, w * 0.2, h * 0.2, 40);
    hills(ctx, w, h * 0.6, 80, '#7cc36b', r);
    ground(ctx, w, h, h * 0.62, '#6ab04c', '#3f8a2c');
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = ['#fff', '#ffe066', '#ff8fab'][k % 3];
      ctx.beginPath();
      ctx.arc(r() * w, h * 0.66 + r() * h * 0.33, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  forest(ctx, w, h, r) {
    sky(ctx, w, h, '#86c5f0', '#e0f2ff', h * 0.6);
    cloud(ctx, w * 0.7, h * 0.16, 36);
    for (let k = 0; k < 9; k++) fir(ctx, (k + 0.5) * (w / 9) + (r() - 0.5) * 40, h * 0.62, 240 + r() * 120, '#2e6b45');
    ground(ctx, w, h, h * 0.6, '#5f9a45', '#3c6e2c');
    fir(ctx, w * 0.08, h * 0.95, 420, '#1e4d30');
    fir(ctx, w * 0.93, h * 0.97, 460, '#1e4d30');
  },
  taiga(ctx, w, h, r) {
    sky(ctx, w, h, '#9cc9e8', '#eef6fb', h * 0.55);
    mountains(ctx, w, h * 0.56, '#7b8fa6', '#f4f7fb', r, 3);
    for (let k = 0; k < 14; k++) fir(ctx, (k + 0.5) * (w / 14), h * 0.62 + r() * 20, 160 + r() * 80, '#264f3a');
    ground(ctx, w, h, h * 0.62, '#f2f5f8', '#d6e0ea');
  },
  snow(ctx, w, h, r) {
    sky(ctx, w, h, '#a9c7e3', '#eef4fa', h * 0.58);
    hills(ctx, w, h * 0.6, 70, '#f7fbff', r);
    ground(ctx, w, h, h * 0.62, '#ffffff', '#dfe9f3');
    for (let k = 0; k < 5; k++) fir(ctx, (k + 0.5) * (w / 5) + (r() - 0.5) * 80, h * 0.6, 200, '#2f5d48');
    for (let k = 0; k < 90; k++) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 3 + r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  river(ctx, w, h, r) {
    sky(ctx, w, h, '#8cc6ef', '#e5f4ff', h * 0.45);
    for (let k = 0; k < 8; k++) fir(ctx, (k + 0.5) * (w / 8), h * 0.5, 200 + r() * 60, '#2e6b45');
    ground(ctx, w, h, h * 0.48, '#6b9e4d', '#4d7d36');
    ctx.fillStyle = grad(ctx, h * 0.62, h, ['#4aa3d8', '#1f6fa6']);
    ctx.fillRect(0, h * 0.64, w, h * 0.36);
    waves(ctx, w, h * 0.64, h, 'rgba(255,255,255,0.6)', r);
  },
  lake(ctx, w, h, r) {
    sky(ctx, w, h, '#5aa6e0', '#d9eeff', h * 0.5);
    cloud(ctx, w * 0.25, h * 0.15, 38);
    cloud(ctx, w * 0.7, h * 0.22, 30);
    mountains(ctx, w, h * 0.52, '#5f7485', '#eef3f8', r, 4);
    ctx.fillStyle = grad(ctx, h * 0.52, h, ['#3a9bd0', '#155f8f']);
    ctx.fillRect(0, h * 0.52, w, h * 0.48);
    waves(ctx, w, h * 0.52, h, 'rgba(255,255,255,0.45)', r);
    ctx.fillStyle = '#6c8f4a';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.quadraticCurveTo(w * 0.2, h * 0.84, w * 0.4, h);
    ctx.fill();
  },
  ice(ctx, w, h, r) {
    sky(ctx, w, h, '#7ab9e6', '#e8f5ff', h * 0.55);
    ctx.fillStyle = '#e3f1fb';
    ctx.beginPath();
    ctx.moveTo(w * 0.05, h * 0.56);
    ctx.lineTo(w * 0.15, h * 0.4);
    ctx.lineTo(w * 0.3, h * 0.56);
    ctx.fill();
    ground(ctx, w, h, h * 0.55, '#f5fbff', '#cfe4f3');
    ctx.strokeStyle = 'rgba(120,170,210,0.5)';
    ctx.lineWidth = 3;
    for (let k = 0; k < 10; k++) {
      ctx.beginPath();
      const x = r() * w;
      const y = h * 0.6 + r() * h * 0.35;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 60 + r() * 80, y + (r() - 0.5) * 40);
      ctx.stroke();
    }
  },
  sea(ctx, w, h, r) {
    sky(ctx, w, h, '#62b0e8', '#dff1ff', h * 0.55);
    sun(ctx, w * 0.15, h * 0.2, 50);
    ctx.fillStyle = grad(ctx, h * 0.55, h, ['#2f8fcf', '#0d4f80']);
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
    waves(ctx, w, h * 0.55, h, 'rgba(255,255,255,0.5)', r);
  },
  underwater(ctx, w, h, r) {
    ctx.fillStyle = grad(ctx, 0, h, ['#5cc3e8', '#0f5d8a', '#08344f']);
    ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 30; k++) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r() * w, r() * h * 0.8, 4 + r() * 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#c8b27a';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.quadraticCurveTo(w * 0.5, h * 0.82, w, h);
    ctx.fill();
  },
  field(ctx, w, h, r) {
    sky(ctx, w, h, '#58a9e6', '#dff0ff', h * 0.5);
    sun(ctx, w * 0.8, h * 0.18, 60);
    cloud(ctx, w * 0.25, h * 0.2, 34);
    ground(ctx, w, h, h * 0.5, '#9bc53d', '#5d8a1f');
    for (let k = 0; k < 60; k++) {
      ctx.fillStyle = '#f2c230';
      ctx.beginPath();
      const y = h * 0.52 + r() * h * 0.18;
      ctx.arc(r() * w, y, 6 + (y - h * 0.5) * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  garden(ctx, w, h, r) {
    sky(ctx, w, h, '#78bdf0', '#e6f5ff', h * 0.5);
    sun(ctx, w * 0.2, h * 0.18, 50);
    ground(ctx, w, h, h * 0.5, '#7a5230', '#4d321c');
    ctx.strokeStyle = '#5e3d22';
    ctx.lineWidth = 8;
    for (let k = 1; k < 5; k++) {
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5 + k * 90);
      ctx.lineTo(w, h * 0.5 + k * 90);
      ctx.stroke();
    }
  },
  sky(ctx, w, h, r) {
    sky(ctx, w, h, '#3f95e0', '#cfe9ff', h);
    cloud(ctx, w * 0.15, h * 0.18, 44);
    cloud(ctx, w * 0.72, h * 0.12, 30);
    ctx.fillStyle = '#6fae4f';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.quadraticCurveTo(w * 0.5, h * 0.8, w, h);
    ctx.fill();
  },
  night(ctx, w, h, r) {
    sky(ctx, w, h, '#0b1633', '#2a3f73', h * 0.75);
    stars(ctx, w, h * 0.7, r, 100);
    ground(ctx, w, h, h * 0.75, '#1c2b3f', '#0e1624');
  },
  space(ctx, w, h, r) {
    ctx.fillStyle = grad(ctx, 0, h, ['#050816', '#141a3a', '#060a18']);
    ctx.fillRect(0, 0, w, h);
    stars(ctx, w, h, r, 220);
  },
  moonsurface(ctx, w, h, r) {
    SCENES.space(ctx, w, h, r);
    ground(ctx, w, h, h * 0.66, '#b9b9b9', '#6d6d6d');
    for (let k = 0; k < 12; k++) {
      ctx.fillStyle = 'rgba(80,80,80,0.5)';
      ctx.beginPath();
      ctx.ellipse(r() * w, h * 0.7 + r() * h * 0.28, 30 + r() * 50, 10 + r() * 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  volcano(ctx, w, h, r) {
    sky(ctx, w, h, '#f29b62', '#fde0c4', h * 0.8);
    volcanoCone(ctx, w, h * 0.82, false);
    ground(ctx, w, h, h * 0.8, '#5a3d2e', '#3a261b');
  },
  'volcano-night': function (ctx, w, h, r) {
    sky(ctx, w, h, '#1a1030', '#5a2a3a', h * 0.8);
    stars(ctx, w, h * 0.5, r, 60);
    volcanoCone(ctx, w, h * 0.82, true);
    ground(ctx, w, h, h * 0.8, '#26170f', '#140b07');
  },
  lava(ctx, w, h, r) {
    ctx.fillStyle = grad(ctx, 0, h, ['#2b1410', '#5c1d0c']);
    ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 9; k++) {
      ctx.strokeStyle = k % 2 ? '#ff7a1a' : '#ffb13b';
      ctx.lineWidth = 10 + r() * 16;
      ctx.beginPath();
      let x = r() * w;
      ctx.moveTo(x, 0);
      for (let y = 0; y <= h; y += 90) {
        x += (r() - 0.5) * 140;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },
  mountains(ctx, w, h, r) {
    sky(ctx, w, h, '#6aa9dc', '#e2f0fb', h * 0.7);
    mountains(ctx, w, h * 0.72, '#7a6a5e', '#f5f5f5', r, 2);
    ground(ctx, w, h, h * 0.7, '#8c7a66', '#5e4f40');
  },
};

// Рисует картинку и возвращает canvas (для предпросмотра) — размер 1200×900 или 900×1200
export function drawPicture(pic) {
  const canvas = document.createElement('canvas');
  const w = pic.portrait ? H : W;
  const h = pic.portrait ? W : H;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const rand = rng(pic.name);
  (SCENES[pic.scene] ?? SCENES.sky)(ctx, w, h, rand);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const it of pic.items) {
    const size = it.s * Math.min(w, h) * 1.1;
    ctx.font = `${Math.round(size)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = size * 0.06;
    ctx.shadowOffsetY = size * 0.03;
    ctx.fillText(it.e, it.x * w, it.y * h);
  }
  ctx.shadowColor = 'transparent';
  return canvas;
}

export function pictureBlob(pic, type = 'image/png') {
  const canvas = drawPicture(pic);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, 0.9));
}
