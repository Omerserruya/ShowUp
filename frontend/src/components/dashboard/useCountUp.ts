import { useEffect, useRef, useState } from 'react';

/**
 * Gently animates a number from 0 → target on mount and whenever target changes.
 * Respects prefers-reduced-motion (snaps to the value). Used for the dashboard
 * KPI counters so the numbers feel alive without being gimmicky.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);
  const start = useRef<number | null>(null);
  const from = useRef(0);

  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || durationMs <= 0) {
      setValue(target);
      return;
    }

    from.current = 0;
    start.current = null;

    const tick = (t: number) => {
      if (start.current === null) start.current = t;
      const progress = Math.min(1, (t - start.current) / durationMs);
      // easeOutCubic - quick then settles
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from.current + (target - from.current) * eased));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target, durationMs]);

  return value;
}
