import React, { useEffect, useRef, useState } from 'react';

/**
 * DonutProgress — a reusable event-attendance ring (React + SVG, no chart library).
 * RTL Hebrew. A light-gray track sits under one or more colored arcs that fill
 * clockwise and animate in on mount. Self-contained: renders standalone with the
 * sensible defaults below.
 */

export interface DonutSegment {
  color?: string;
  value: number;
}

export interface DonutProgressProps {
  value?: number;
  total?: number;
  segments?: DonutSegment[];
  label?: string;
  size?: number;
}

// Soft pastel default palette.
const PALETTE = ['#5BC4A8', '#C9A8E0', '#D6DCDC', '#2E4756'];
const TRACK = '#ECEEF1';
const NAVY = '#2E4756';
const GRAY_TEXT = '#9aa3af';

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Tiny inline count-up so the component stays dependency-free. */
function useCountUp(target: number, durationMs = 900): number {
  const [val, setVal] = useState(prefersReduced() ? target : 0);
  const frame = useRef<number | null>(null);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (prefersReduced() || durationMs <= 0) { setVal(target); return; }
    start.current = null;
    const tick = (t: number) => {
      if (start.current === null) start.current = t;
      const p = Math.min(1, (t - start.current) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [target, durationMs]);
  return val;
}

// Sensible default segments (sum = 405) so the component renders standalone.
const DEFAULT_SEGMENTS: DonutSegment[] = [
  { color: '#5BC4A8', value: 275 },
  { color: '#C9A8E0', value: 90 },
  { color: '#D6DCDC', value: 25 },
  { color: '#2E4756', value: 15 },
];

export default function DonutProgress({
  value = 275,
  total = 405,
  segments = DEFAULT_SEGMENTS,
  label = 'מגיעים לאירוע!',
  size = 200,
}: DonutProgressProps) {
  const reduced = prefersReduced();
  const [mounted, setMounted] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setMounted(true), 120);
    return () => clearTimeout(t);
  }, [reduced]);
  const shownValue = useCountUp(value);

  const stroke = Math.round(size * 0.13);
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const GAP = size > 140 ? 8 : 4;

  // Build the arcs to draw. Empty (track only) when total <= 0 or nothing positive.
  const usingSegments = Array.isArray(segments) && segments.length > 0;
  let arcsData: { color: string; value: number }[] = [];
  if (total > 0) {
    if (usingSegments) {
      arcsData = segments
        .filter((s) => s.value > 0)
        .map((s, i) => ({ color: s.color || PALETTE[i % PALETTE.length], value: s.value }));
    } else if (value > 0) {
      arcsData = [{ color: PALETTE[0], value }];
    }
  }
  const denom = total > 0 ? total : 1;
  const multi = arcsData.length > 1;

  let acc = 0;
  const arcs = arcsData.map((s) => {
    const frac = s.value / denom;
    const startLen = acc * C;
    acc += frac;
    return { color: s.color, frac, startLen };
  });

  return (
    <div
      dir="rtl"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
        borderRadius: 28,
        background: '#ffffff',
        boxShadow: '0 8px 30px rgba(16, 24, 40, 0.06)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          {/* background track — full circle */}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TRACK} strokeWidth={stroke} />
          {/* colored arcs on top */}
          {arcs.map((a, i) => {
            const segLen = a.frac * C;
            const drawn = mounted ? Math.max(segLen - (multi ? GAP : 0), 0.001) : 0;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${drawn} ${C}`}
                strokeDashoffset={-a.startLen}
                style={{ transition: reduced ? 'none' : 'stroke-dasharray 1.1s cubic-bezier(.2,.8,.2,1)', transitionDelay: reduced ? '0ms' : `${i * 120}ms` }}
              />
            );
          })}
        </svg>

        {/* center text */}
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div dir="ltr" style={{ display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 800, fontSize: Math.round(size * 0.2), lineHeight: 1, letterSpacing: '-0.02em', color: NAVY }}>
              {shownValue}
            </span>
            <span style={{ fontWeight: 500, fontSize: Math.round(size * 0.115), color: GRAY_TEXT, marginInlineStart: 5 }}>
              / {total}
            </span>
          </div>
          {label && (
            <span style={{ marginTop: 8, fontSize: Math.round(size * 0.07), fontWeight: 600, color: GRAY_TEXT, textAlign: 'center' }}>
              {label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
