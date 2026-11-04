"use client";

import { useEffect, useRef, useState } from "react";

/// The first-visit intro, three seconds: the glass ZENO mark on the ink ground while a pixel field resolves around it
/// and the markets it opens onto tick past. The mark tilts toward the pointer and pixels light up under it. Shown once
/// per browser session, then the curtain lifts. Reduced motion shortens it to a fade.
const KEY = "zeno-intro";
const DURATION = 3000;
const TAPE = ["NVDA", "BTC", "SPY", "GOLD", "TSLA", "ETH", "QQQ", "AAPL", "SILVER", "OIL", "META", "LINK"];

export function IntroLoader() {
  const [phase, setPhase] = useState<"off" | "on" | "leaving">("off");
  const canvas = useRef<HTMLCanvasElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [tape, setTape] = useState(0);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY) === "1";
      sessionStorage.setItem(KEY, "1");
    } catch {
      seen = true;
    }
    if (seen) return;
    setPhase("on");
    document.documentElement.style.overflow = "hidden";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = reduced ? 900 : DURATION;
    const leave = setTimeout(() => setPhase("leaving"), total);
    const done = setTimeout(() => {
      setPhase("off");
      document.documentElement.style.overflow = "";
    }, total + 750);
    return () => {
      clearTimeout(leave);
      clearTimeout(done);
      document.documentElement.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (phase !== "on") return;
    const id = setInterval(() => setTape((n) => n + 1), 180);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "on" || !canvas.current) return;
    const el = canvas.current;
    const ctx = el.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const cell = 22;
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let born: Float32Array = new Float32Array(0);
    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = w * dpr;
      el.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      // Each pixel resolves at its own moment, sooner near the centre.
      born = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const d = Math.hypot(c - cols / 2, r - rows / 2) / Math.hypot(cols / 2, rows / 2);
          born[r * cols + c] = d * 1700 + Math.random() * 900;
        }
    };
    resize();
    let mx = w / 2;
    let my = h / 2;
    const onMove = (event: PointerEvent) => {
      mx = event.clientX;
      my = event.clientY;
      if (mark.current) {
        const rx = ((my / h) - 0.5) * -24;
        const ry = ((mx / w) - 0.5) * 24;
        mark.current.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("resize", resize);
    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const age = t - born[r * cols + c]!;
          if (age < 0) continue;
          const x = c * cell + cell / 2;
          const y = r * cell + cell / 2;
          const near = Math.max(0, 1 - Math.hypot(x - mx, y - my) / 160);
          const base = Math.min(1, age / 400) * 0.09;
          const a = base + near * 0.55;
          ctx.fillStyle = near > 0.05 ? `rgba(210,245,58,${a})` : `rgba(238,242,226,${a})`;
          const s = 2 + near * 4;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, t / DURATION)})`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", resize);
    };
  }, [phase]);

  if (phase === "off") return null;
  return (
    <div
      role="status"
      aria-label="Loading ZENOMARKETS"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-ink text-[#eef2e2] transition-[clip-path] duration-700 ease-[cubic-bezier(.76,0,.24,1)] ${phase === "leaving" ? "[clip-path:inset(0_0_100%_0)]" : "[clip-path:inset(0_0_0_0)]"}`}
    >
      <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full" />
      <div className="relative flex flex-col items-center">
        <div ref={mark} className="intro-mark transition-transform duration-200 ease-out will-change-transform">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zeno-glass.png" alt="" width={220} height={220} className="h-40 w-40 drop-shadow-[0_0_60px_rgba(210,245,58,0.45)] sm:h-52 sm:w-52" />
        </div>
        <p className="intro-word mt-6 font-display text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
          ZENO<span className="font-pixel font-medium text-[#d2f53a]">MARKETS</span>
        </p>
        <p className="mt-3 h-6 font-pixel text-sm tracking-[0.18em] text-[#a4a995]">
          LOADING <span className="text-[#d2f53a]">{TAPE[tape % TAPE.length]}</span> · {TAPE[(tape + 3) % TAPE.length]} · {TAPE[(tape + 7) % TAPE.length]}
        </p>
        <div className="mt-6 h-[3px] w-56 overflow-hidden rounded-full bg-[#eef2e2]/10">
          <div ref={bar} className="h-full w-full origin-left scale-x-[0.02] bg-[#d2f53a] shadow-[0_0_12px_#d2f53a]" />
        </div>
      </div>
      <p className="absolute bottom-8 font-mono text-[11px] uppercase tracking-[0.3em] text-[#a4a995]">One view. A world of markets.</p>
    </div>
  );
}
