/**
 * Dependency-free celebratory confetti burst.
 *
 * fireConfetti() paints a short-lived full-screen <canvas> overlay and animates
 * a burst of brand-colored particles, then removes itself. Used for first-time
 * delight moments (first guest confirmed, first campaign sent).
 *
 * Each burst is guarded by a localStorage key when called via fireConfettiOnce()
 * so the "first time" celebration only happens once per browser.
 */

const BRAND_COLORS = ['#6D28D9', '#A78BFA', '#EC4899', '#F59E0B', '#16A34A', '#4C1D95'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vrotation: number;
}

export function fireConfetti(durationMs = 2200): void {
  if (typeof document === 'undefined') return;
  // Respect users who prefer reduced motion.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '2147483647';
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const w = window.innerWidth;
  const h = window.innerHeight;
  const count = Math.min(180, Math.round(w / 5));
  const particles: Particle[] = [];
  // Single celebratory burst from the centre of the screen, radiating outward in
  // all directions; gravity then pulls everything down for a natural fall.
  const originX = w * 0.5;
  const originY = h * 0.42;
  for (let i = 0; i < count; i++) {
    // Spread evenly around a full circle, biased slightly upward, with a varied
    // speed so the burst has depth (no Math.random dependency at import time).
    const angle = (i / count) * Math.PI * 2 + (i % 7) * 0.09;
    const speed = 6 + ((i * 53) % 90) / 9;
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3, // slight upward bias
      size: 6 + ((i * 13) % 7),
      color: BRAND_COLORS[i % BRAND_COLORS.length],
      rotation: (i * 0.5) % (Math.PI * 2),
      vrotation: ((i % 5) - 2) * 0.15,
    });
  }

  const start = performance.now();
  const gravity = 0.18;

  function frame(now: number) {
    const elapsed = now - start;
    ctx!.clearRect(0, 0, w, h);
    const fade = Math.max(0, 1 - Math.max(0, elapsed - durationMs * 0.6) / (durationMs * 0.4));
    ctx!.globalAlpha = fade;
    for (const p of particles) {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.vrotation;
      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rotation);
      ctx!.fillStyle = p.color;
      ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx!.restore();
    }
    if (elapsed < durationMs) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}

/**
 * Fire the confetti only the first time for a given key (per browser).
 * Returns true if it fired, false if it was already used.
 */
export function fireConfettiOnce(key: string): boolean {
  if (typeof window === 'undefined') return false;
  const storageKey = `confetti_done_${key}`;
  try {
    if (localStorage.getItem(storageKey)) return false;
    localStorage.setItem(storageKey, '1');
  } catch {
    // localStorage unavailable - just fire it.
  }
  fireConfetti();
  return true;
}
