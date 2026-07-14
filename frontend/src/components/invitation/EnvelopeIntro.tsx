import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { InvitationConfig } from './types';

/* ------------------------------------------------------------------ *
 * EnvelopeIntro - a full-bleed paper envelope. The top flap spans the full
 * width; the left/right seams begin at a shoulder partway down the edges and
 * angle in to a centre apex (where the seal sits). Depth is tuned per device
 * so it reads like a real envelope and fills the whole page.
 *
 * The notch under the flap is TRANSPARENT (no dark inside) and the whole
 * thing sits over the real invitation, so the flap rotating open reveals
 * the invitation THROUGH the opening; then the pocket fades away.
 *
 * The wax seal is copied verbatim from wedding-envelope-v3.svg (paths,
 * gradients, ring, THE / script engraving); colours/fonts/text are dynamic.
 * ------------------------------------------------------------------ */

function shade(hex: string, pct: number): string {
  const h = (hex || '#000').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  let r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  if ([r, g, b].some((x) => isNaN(x))) return hex;
  const target = pct < 0 ? 0 : 255, p = Math.min(1, Math.abs(pct) / 100);
  r = Math.round(r + (target - r) * p); g = Math.round(g + (target - g) * p); b = Math.round(b + (target - b) * p);
  const to = (x: number) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// A light paper colour makes the hardcoded cream text invisible - decide by luminance.
function isLight(hex: string): boolean {
  const h = (hex || '#000').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  if ([r, g, b].some((x) => isNaN(x))) return false;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}

function FilterDefs({ p, w, h, waxStops, waxInner, emboss }: { p: string; w: number; h: number; waxStops: string[]; waxInner: string[]; emboss: number }) {
  return (
    <defs>
      <filter id={`${p}-paper`} filterUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
        <feTurbulence type="fractalNoise" baseFrequency="0.058" numOctaves="4" result="noise" />
        <feDiffuseLighting in="noise" lightingColor="#ffffff" surfaceScale={emboss} diffuseConstant="0.76" result="light">
          <feDistantLight azimuth="60" elevation="45" />
        </feDiffuseLighting>
        <feComposite in="SourceGraphic" in2="light" operator="arithmetic" k1="2" k2="0" k3="0" k4="0" />
      </filter>
      <filter id={`${p}-cast`} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="12" /><feOffset dy="9" />
      </filter>
      <filter id={`${p}-fold`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" /></filter>
      <filter id={`${p}-sealshadow`} x="-70%" y="-70%" width="240%" height="240%">
        <feDropShadow dx="0" dy="13" stdDeviation="18" floodColor="#000" floodOpacity="0.72" />
      </filter>
      <filter id={`${p}-wax3d`} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="7" result="height" />
        <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="11" result="tex" />
        <feDisplacementMap in="height" in2="tex" scale="7" result="bump" />
        <feDiffuseLighting in="bump" surfaceScale="9" diffuseConstant="0.95" lightingColor="#fffdf8" result="diff">
          <feDistantLight azimuth="230" elevation="52" />
        </feDiffuseLighting>
        <feComposite in="diff" in2="SourceGraphic" operator="arithmetic" k1="1.62" k2="0" k3="0" k4="0" result="lit" />
        <feSpecularLighting in="bump" surfaceScale="10" specularConstant="0.6" specularExponent="30" lightingColor="#fffaf0" result="spec">
          <fePointLight x="-45" y="-55" z="85" />
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specClip" />
        <feComposite in="lit" in2="specClip" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
      </filter>
      <filter id={`${p}-waxinset`} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="hb" />
        <feDiffuseLighting in="hb" surfaceScale="-4" diffuseConstant="1.1" lightingColor="#fff" result="d">
          <feDistantLight azimuth="230" elevation="55" />
        </feDiffuseLighting>
        <feComposite in="d" in2="SourceGraphic" operator="arithmetic" k1="1.4" k2="0" k3="0" k4="0" />
      </filter>
      <radialGradient id={`${p}-wax`} cx="40%" cy="34%" r="78%">
        <stop offset="0%" stopColor={waxStops[0]} /><stop offset="50%" stopColor={waxStops[1]} />
        <stop offset="82%" stopColor={waxStops[2]} /><stop offset="100%" stopColor={waxStops[3]} />
      </radialGradient>
      <radialGradient id={`${p}-waxinner`} cx="46%" cy="40%" r="68%">
        <stop offset="0%" stopColor={waxInner[0]} /><stop offset="100%" stopColor={waxInner[1]} />
      </radialGradient>
    </defs>
  );
}

function dims() {
  if (typeof window === 'undefined') return { w: 800, h: 1200 };
  return { w: window.innerWidth || 800, h: window.innerHeight || 1200 };
}

export interface EnvelopeIntroProps {
  config: InvitationConfig;
  names: string;
  embedded?: boolean;
  onDone?: () => void;
}

export default function EnvelopeIntro({ config, names, embedded, onDone }: EnvelopeIntroProps) {
  const env = config.envelope || {};
  const paper = env.color || '#3e121a';
  const wax = env.waxColor || '#d8ccb8';
  const font = env.font || '"Frank Ruhl Libre", serif';

  const useExact = !env.waxColor || env.waxColor.toLowerCase() === '#d8ccb8';
  const waxStops = useExact ? ['#f5efe4', '#eae1d2', '#d8ccb8', '#bfb097'] : [shade(wax, 34), shade(wax, 8), shade(wax, -14), shade(wax, -34)];
  const waxInner = useExact ? ['#f3ece0', '#e0d5c2'] : [shade(wax, 26), shade(wax, -6)];
  const engrave = useExact ? '#9a8a68' : shade(wax, -42);
  const ring = useExact ? '#a8998a' : shade(wax, -28);
  // Ink for text written on the paper: dark (a deep shade of the paper) on
  // light envelopes, the original creams on dark ones.
  const lightPaper = isLight(paper);
  const paperInk = lightPaper ? shade(paper, -72) : '#e7d8c4';
  const paperInkStrong = lightPaper ? shade(paper, -80) : '#efe2d2';
  const sealScript = (env.stampText && env.stampText.trim()) || 'wedding';
  const paperLines = (env.paperText && env.paperText.trim()) ? env.paperText.trim().split('\n').slice(0, 3) : [];

  const [{ w, h }, setDim] = useState(dims);
  useEffect(() => {
    const onR = () => setDim(dims());
    window.addEventListener('resize', onR);
    window.addEventListener('orientationchange', onR);
    return () => { window.removeEventListener('resize', onR); window.removeEventListener('orientationchange', onR); };
  }, []);

  const cx = Math.round(w / 2);
  const portrait = h >= w;
  // The flap spans the FULL width across the top; the change is on the SIDES:
  // the left/right seams start at a shoulder `sy` partway down the edges (not
  // the top corners), and the flap dips to a centre apex `ay`.
  const sy = Math.round(portrait ? h * 0.24 : h * 0.22);
  const ay = Math.round(portrait ? h * 0.62 : h * 0.56);
  const sealScale = Math.max(0.75, Math.min(1.7, 1.35 * (h / 1200)));
  // The SVG paper filter renders in CSS-px space then upscales to the device's
  // pixel ratio, softening the emboss on hi-DPI (mobile) screens. Scale the
  // emboss depth with the pixel ratio so the texture reads the same everywhere.
  const dpr = typeof window !== 'undefined' ? Math.min(3, Math.max(1, window.devicePixelRatio || 1)) : 1;
  const emboss = Math.min(3.4, 1.15 * dpr);

  const [phase, setPhase] = useState<'closed' | 'opening' | 'done'>('closed');
  const opening = phase === 'opening';
  const armed = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const open = () => { if (!armed.current) { armed.current = true; setPhase('opening'); } };

  useEffect(() => {
    if (phase !== 'opening') return;
    const id = setTimeout(() => { setPhase('done'); onDone?.(); }, 1550);
    return () => clearTimeout(id);
  }, [phase, onDone]);

  // Freeze the page behind until the envelope has fully disappeared, and
  // capture scroll/touch on the overlay to trigger opening without ever
  // letting the gesture reach (and scroll) the page underneath.
  useEffect(() => {
    if (embedded || phase === 'done') return;
    const body = document.body, html = document.documentElement;
    const prev = { bo: body.style.overflow, ho: html.style.overflow, bt: body.style.touchAction, ob: (body.style as any).overscrollBehavior };
    body.style.overflow = 'hidden'; html.style.overflow = 'hidden';
    body.style.touchAction = 'none'; (body.style as any).overscrollBehavior = 'none';
    const el = overlayRef.current;
    const block = (e: Event) => { e.preventDefault(); open(); };
    el?.addEventListener('wheel', block, { passive: false });
    el?.addEventListener('touchmove', block, { passive: false });
    return () => {
      body.style.overflow = prev.bo; html.style.overflow = prev.ho;
      body.style.touchAction = prev.bt; (body.style as any).overscrollBehavior = prev.ob;
      el?.removeEventListener('wheel', block); el?.removeEventListener('touchmove', block);
    };
  }, [phase, embedded]);

  useEffect(() => { if (!embedded && phase === 'done') window.scrollTo(0, 0); }, [phase, embedded]);

  if (phase === 'done') return null;

  const svgBox = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%' };
  const viewBox = `0 0 ${w} ${h}`;
  // Pocket = the lower part, its top edge a V opening (side shoulders → centre
  // apex). Flap = the top part covering that V; it lifts to reveal the mouth.
  const pocketPath = `M 0,${sy} L 0,${h} L ${w},${h} L ${w},${sy} L ${cx},${ay} Z`;
  const flapPath = `M 0,0 L ${w},0 L ${w},${sy + 2} L ${cx},${ay + 2} L 0,${sy + 2} Z`;

  return (
    <Box
      ref={overlayRef}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') open(); }}
      role="button" tabIndex={0} aria-label="פתחו את ההזמנה"
      sx={{ position: embedded ? 'absolute' : 'fixed', inset: 0, zIndex: embedded ? 40 : 2000, overflow: 'hidden', cursor: 'pointer', outline: 'none', perspective: '2400px', touchAction: 'none', overscrollBehavior: 'none' }}
    >
      {/* Pocket + fold lines + teaser text; the notch is transparent so the
          invitation shows through once the flap lifts. Fades after opening. */}
      <Box sx={{ ...svgBox, opacity: opening ? 0 : 1, transition: 'opacity 1.1s ease' }}>
        <Box component="svg" viewBox={viewBox} preserveAspectRatio="none" sx={svgBox}>
          <FilterDefs p="eb" w={w} h={h} waxStops={waxStops} waxInner={waxInner} emboss={emboss} />
          <path d={pocketPath} fill={paper} filter="url(#eb-paper)" />
          <g filter="url(#eb-fold)" fill="none" stroke="#000" strokeWidth="4" opacity="0.28">
            <path d={`M ${cx},${ay} L 0,${h}`} /><path d={`M ${cx},${ay} L ${w},${h}`} />
          </g>
          <g textAnchor="middle">
            {paperLines.map((line, i) => (
              <text key={i} x={cx} y={h - Math.round(h * 0.10) - (paperLines.length - 1 - i) * Math.round(h * 0.045)}
                fontFamily={font} fontStyle="italic" fontSize={Math.round(h * 0.026)} fill={paperInk}>{line}</text>
            ))}
            <text x={cx} y={h - Math.round(h * 0.04)} fontFamily={font} fontSize={Math.round(h * 0.04)} fill={paperInkStrong}>{names}</text>
          </g>
        </Box>
      </Box>

      {/* Flap + wax seal - hinged along the top edge, opens slowly */}
      <Box sx={{
        position: 'absolute', inset: 0, transformOrigin: 'top center', transformStyle: 'preserve-3d',
        transform: opening ? 'rotateX(150deg)' : 'rotateX(0deg)', opacity: opening ? 0 : 1,
        transition: 'transform 1.45s cubic-bezier(.42,.02,.18,1), opacity 1.1s ease', backfaceVisibility: 'hidden',
      }}>
        <Box component="svg" viewBox={viewBox} preserveAspectRatio="none" sx={svgBox}>
          <FilterDefs p="ef" w={w} h={h} waxStops={waxStops} waxInner={waxInner} emboss={emboss} />
          <path d={flapPath} fill="#000" opacity="0.5" filter="url(#ef-cast)" />
          <path d={flapPath} fill={paper} filter="url(#ef-paper)" />
          <g transform={`translate(${cx} ${ay}) scale(${sealScale})`}>
            <path filter="url(#ef-sealshadow)" fill="#000" opacity="0.65" d="
              M0,-90 C40,-90 92,-50 90,-24 C88,6 96,30 84,52 C70,74 40,90 -4,90
              C-40,90 -78,68 -90,40 C-98,12 -92,-16 -84,-40 C-74,-62 -44,-90 0,-90 Z" />
            <path filter="url(#ef-wax3d)" fill="url(#ef-wax)" d="
              M0,-92 C26,-93 41,-81 55,-72 C75,-60 93,-51 90,-25 C88,-4 97,9 87,31
              C79,52 59,61 44,75 C27,89 14,93 -5,90 C-27,87 -43,81 -59,68
              C-77,53 -93,43 -90,17 C-88,-3 -95,-19 -84,-39 C-73,-59 -55,-67 -39,-79
              C-25,-89 -19,-93 0,-92 Z" />
            <circle r="66" fill="url(#ef-waxinner)" filter="url(#ef-waxinset)" />
            <circle r="66" fill="none" stroke={ring} strokeWidth="1" opacity="0.4" />
            <text x="0" y="-6" textAnchor="middle" fontFamily="Georgia,'Times New Roman',serif" fontSize="18" letterSpacing="4" fill={engrave} opacity="0.9">THE</text>
            <text x="0" y="0" textAnchor="middle" fontFamily="Georgia,'Times New Roman',serif" fontSize="18" letterSpacing="4" fill="#fff" opacity="0.15">THE</text>
            <text x="0" y="25" textAnchor="middle" fontFamily={font} fontStyle="italic" fontSize="33" fill={engrave} opacity="0.9">{sealScript}</text>
            <text x="0" y="26.5" textAnchor="middle" fontFamily={font} fontStyle="italic" fontSize="33" fill="#fff" opacity="0.15">{sealScript}</text>
          </g>
        </Box>
      </Box>

      {!opening && (
        <Box sx={{ position: 'absolute', bottom: 'max(24px, env(safe-area-inset-bottom))', left: 0, right: 0, textAlign: 'center', zIndex: 3, pointerEvents: 'none' }}>
          <Typography sx={{ fontFamily: '"Assistant", sans-serif', fontSize: 13, letterSpacing: 4, color: paperInk, opacity: 0.9 }}>הקליקו או גללו לפתיחה</Typography>
          <Typography sx={{ fontSize: 20, color: paperInk, opacity: 0.75, mt: 0.5, animation: 'evBob 1.8s ease-in-out infinite', '@keyframes evBob': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(6px)' } } }}>↓</Typography>
        </Box>
      )}
    </Box>
  );
}
