/**
 * Ambient layer: a field of slow-drifting energy motes on a canvas, behind the
 * CSS auroral hazes. Cheap (a few dozen points), DPR-aware, paused when the tab
 * is hidden, and entirely skipped for prefers-reduced-motion.
 */
import { useEffect, useRef } from "react";

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number; // 0 = cyan, 1 = amber
  phase: number;
}

export function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let motes: Mote[] = [];

    const seed = () => {
      const count = Math.round(Math.min(46, (w * h) / 34000));
      motes = Array.from({ length: count }, (_, i) => ({
        x: ((i * 97.13) % w),
        y: ((i * 53.71) % h),
        vx: (((i * 13) % 7) - 3) * 0.02,
        vy: -0.06 - (((i * 17) % 5) * 0.012),
        r: 0.6 + ((i * 31) % 18) / 10,
        hue: (i * 7) % 5 === 0 ? 1 : 0,
        phase: (i * 0.6) % (Math.PI * 2),
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    let raf = 0;
    let t = 0;
    const draw = () => {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.x += m.vx;
        m.y += m.vy;
        if (m.y < -10) {
          m.y = h + 8;
          m.x = (m.x + 137) % w;
        }
        if (m.x < -10) m.x = w + 8;
        if (m.x > w + 10) m.x = -8;
        const twinkle = 0.35 + 0.4 * Math.sin(t * 1.2 + m.phase);
        const color = m.hue ? "224,168,60" : "88,199,214";
        ctx.beginPath();
        const grad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 6);
        grad.addColorStop(0, `rgba(${color},${0.5 * twinkle})`);
        grad.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = grad;
        ctx.arc(m.x, m.y, m.r * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        raf = requestAnimationFrame(draw);
      }
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 -z-[1] h-full w-full opacity-70"
      aria-hidden="true"
    />
  );
}
