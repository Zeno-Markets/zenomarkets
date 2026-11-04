"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Spark } from "@/app/api/spark/route";
import { CLASS_LABEL, type CardMarket } from "./data";

/// The hero: live market cards on the inside of a slowly turning cylinder, seen from behind its axis so the cards at
/// the edges swing toward the viewer (the curved wall the reference uses). Drag to spin, hover to lift, click to trade.
/// Each card is a canvas texture drawn from real prices; it is redrawn when the data refreshes. Rendering pauses while
/// the hero is off screen or the tab is hidden.

const CARD_W = 2.9;
const CARD_H = 3.77;
const RADIUS = 10.5;
const TEX_W = 500;
const TEX_H = 650;

function fontOf(variable: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.fontFamily = `var(${variable}), ${fallback}`;
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fmtUsd(value: number): string {
  const digits = value >= 1000 ? 0 : value >= 10 ? 2 : 3;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtPct(value: number): string {
  const fixed = Math.abs(value) < 0.005 ? 0.01 : Math.abs(value);
  return `${value >= 0 ? "+" : "−"}${fixed.toFixed(2)}%`;
}

function drawCard(canvas: HTMLCanvasElement, market: CardMarket, spark: Spark | undefined, fonts: { sans: string; pixel: string; mono: string }, hot: boolean) {
  const ctx = canvas.getContext("2d")!;
  const up = (spark?.changePct ?? 0) >= 0;
  const lime = "#d2f53a";
  const tone = up ? lime : "#ff6b5e";
  ctx.clearRect(0, 0, TEX_W, TEX_H);

  // Glass body: near-black olive with a lime rim light along the top edge.
  roundRect(ctx, 6, 6, TEX_W - 12, TEX_H - 12, 34);
  const body = ctx.createLinearGradient(0, 0, TEX_W, TEX_H);
  body.addColorStop(0, hot ? "#1f2612" : "#161a0d");
  body.addColorStop(0.55, "#0c0f06");
  body.addColorStop(1, "#090b04");
  ctx.fillStyle = body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const glow = ctx.createRadialGradient(TEX_W * 0.85, -40, 10, TEX_W * 0.85, -40, 420);
  glow.addColorStop(0, "rgba(210,245,58,0.38)");
  glow.addColorStop(1, "rgba(210,245,58,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  // Pixel grid texture, faint.
  ctx.fillStyle = "rgba(238,242,226,0.035)";
  for (let y = 18; y < TEX_H; y += 22) for (let x = 18; x < TEX_W; x += 22) ctx.fillRect(x, y, 2, 2);
  ctx.restore();
  ctx.lineWidth = hot ? 3 : 2;
  ctx.strokeStyle = hot ? "rgba(210,245,58,0.9)" : "rgba(210,245,58,0.28)";
  roundRect(ctx, 7, 7, TEX_W - 14, TEX_H - 14, 33);
  ctx.stroke();

  // Header: asset class (pixel) and leverage pill.
  ctx.fillStyle = lime;
  ctx.font = `600 26px ${fonts.pixel}`;
  ctx.textBaseline = "top";
  ctx.fillText(CLASS_LABEL[market.assetClass].toUpperCase(), 38, 40);
  const lev = `${market.maxLeverage}x`;
  ctx.font = `600 24px ${fonts.mono}`;
  const lw = ctx.measureText(lev).width + 28;
  roundRect(ctx, TEX_W - 38 - lw, 34, lw, 40, 20);
  ctx.fillStyle = "rgba(210,245,58,0.14)";
  ctx.fill();
  ctx.fillStyle = lime;
  ctx.fillText(lev, TEX_W - 38 - lw + 14, 43);

  // Symbol and name.
  ctx.fillStyle = "#eef2e2";
  ctx.font = `700 88px ${fonts.sans}`;
  ctx.fillText(market.symbol, 34, 100);
  ctx.fillStyle = "rgba(238,242,226,0.6)";
  ctx.font = `500 26px ${fonts.sans}`;
  ctx.fillText(market.name.length > 26 ? `${market.name.slice(0, 25)}…` : market.name, 38, 200);

  // Sparkline with a fading fill.
  const closes = spark?.closes ?? [];
  const top = 270;
  const bottom = 470;
  if (closes.length > 1) {
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || max * 0.01;
    const px = (i: number) => 34 + (i / (closes.length - 1)) * (TEX_W - 68);
    const py = (v: number) => bottom - ((v - min) / span) * (bottom - top);
    ctx.beginPath();
    closes.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))));
    ctx.lineTo(px(closes.length - 1), bottom + 20);
    ctx.lineTo(px(0), bottom + 20);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, top, 0, bottom + 20);
    fill.addColorStop(0, up ? "rgba(210,245,58,0.32)" : "rgba(255,107,94,0.28)");
    fill.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    closes.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))));
    ctx.strokeStyle = tone;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.stroke();
    const lx = px(closes.length - 1);
    const ly = py(closes[closes.length - 1]!);
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.arc(lx, ly, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Footer: price and change.
  if (spark) {
    ctx.fillStyle = "#eef2e2";
    ctx.font = `600 50px ${fonts.sans}`;
    ctx.fillText(fmtUsd(spark.price), 34, 520);
    const change = fmtPct(spark.changePct);
    ctx.font = `600 26px ${fonts.mono}`;
    const cw = ctx.measureText(change).width + 28;
    roundRect(ctx, 34, 586, cw, 40, 8);
    ctx.fillStyle = up ? "rgba(210,245,58,0.16)" : "rgba(255,107,94,0.16)";
    ctx.fill();
    ctx.fillStyle = tone;
    ctx.fillText(change, 48, 594);
    ctx.fillStyle = "rgba(238,242,226,0.45)";
    ctx.font = `500 22px ${fonts.mono}`;
    ctx.fillText("PERP · OPTIONS", TEX_W - 38 - ctx.measureText("PERP · OPTIONS").width, 596);
  }
}

export function HeroCarousel({ markets, sparks }: { markets: CardMarket[]; sparks: Record<string, Spark> | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const redraw = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const data = useRef({ markets, sparks });
  data.current = { markets, sparks };

  useEffect(() => {
    redraw.current?.();
  }, [markets, sparks]);

  useEffect(() => {
    const el = host.current;
    if (!el || markets.length === 0) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      await document.fonts.ready;
      if (disposed) return;
      const fonts = { sans: fontOf("--font-geist", "sans-serif"), pixel: fontOf("--font-pixelify", "monospace"), mono: fontOf("--font-geist-mono", "monospace") };
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement);
      renderer.domElement.style.touchAction = "pan-y";
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 0.15, RADIUS * 0.72);
      const ring = new THREE.Group();
      scene.add(ring);

      // Enough cards to wrap the whole circle with a small gap; markets repeat when the list is short.
      const step = (CARD_W + 0.45) / RADIUS;
      const count = Math.floor((Math.PI * 2) / step);
      const cards: { mesh: InstanceType<typeof THREE.Mesh>; canvas: HTMLCanvasElement; texture: InstanceType<typeof THREE.CanvasTexture>; market: CardMarket; lift: number; hot: boolean }[] = [];
      const geometry = new THREE.PlaneGeometry(CARD_W, CARD_H, 1, 1);
      for (let i = 0; i < count; i++) {
        const market = data.current.markets[i % data.current.markets.length]!;
        const canvas = document.createElement("canvas");
        canvas.width = TEX_W;
        canvas.height = TEX_H;
        drawCard(canvas, market, data.current.sparks?.[market.symbol], fonts, false);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geometry, material);
        const angle = i * step;
        mesh.position.set(Math.sin(angle) * RADIUS, 0, -Math.cos(angle) * RADIUS);
        mesh.rotation.y = -angle;
        mesh.userData.index = i;
        ring.add(mesh);
        cards.push({ mesh, canvas, texture, market, lift: 0, hot: false });
      }
      redraw.current = () => {
        for (const card of cards) {
          const market = data.current.markets.find((m) => m.symbol === card.market.symbol) ?? card.market;
          drawCard(card.canvas, market, data.current.sparks?.[market.symbol], fonts, card.hot);
          card.texture.needsUpdate = true;
        }
      };

      const resize = () => {
        const { width, height } = el.getBoundingClientRect();
        renderer.setSize(width, height, false);
        renderer.domElement.style.width = `${width}px`;
        renderer.domElement.style.height = `${height}px`;
        camera.aspect = width / Math.max(height, 1);
        // Narrow screens pull the camera back so at least three cards show.
        camera.position.z = RADIUS * (width < 640 ? 0.12 : width < 1024 ? 0.3 : 0.42);
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(el);

      // Spin: a constant drift plus drag velocity with friction.
      let rotation = 0;
      let velocity = 0;
      let dragging = false;
      let lastX = 0;
      let moved = 0;
      const drift = reduced ? 0 : 0.0016;
      const pointer = new THREE.Vector2(-9, -9);
      const ray = new THREE.Raycaster();
      let hovered: (typeof cards)[number] | undefined;

      const onDown = (event: PointerEvent) => {
        dragging = true;
        moved = 0;
        lastX = event.clientX;
        renderer.domElement.setPointerCapture(event.pointerId);
      };
      const onMove = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        if (!dragging) return;
        const dx = event.clientX - lastX;
        lastX = event.clientX;
        moved += Math.abs(dx);
        velocity = -dx * 0.0022;
        rotation += velocity;
      };
      const onUp = (event: PointerEvent) => {
        dragging = false;
        renderer.domElement.releasePointerCapture?.(event.pointerId);
        if (moved < 6 && hovered) router.push(`/perpetuals?market=${hovered.market.symbol}`);
      };
      const onLeave = () => pointer.set(-9, -9);
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointerleave", onLeave);

      let visible = true;
      const io = new IntersectionObserver(([entry]) => (visible = Boolean(entry?.isIntersecting)), { threshold: 0 });
      io.observe(el);
      let frame = 0;
      let firstFrame = true;
      const tick = () => {
        frame = requestAnimationFrame(tick);
        if (!visible || document.hidden) return;
        if (!dragging) {
          velocity *= 0.94;
          rotation += velocity + drift;
        }
        ring.rotation.y = rotation;
        ray.setFromCamera(pointer, camera);
        const hit = ray.intersectObjects(ring.children, false)[0];
        const next = hit ? cards[hit.object.userData.index as number] : undefined;
        if (next !== hovered) {
          if (hovered) {
            hovered.hot = false;
            drawCard(hovered.canvas, hovered.market, data.current.sparks?.[hovered.market.symbol], fonts, false);
            hovered.texture.needsUpdate = true;
          }
          if (next) {
            next.hot = true;
            drawCard(next.canvas, next.market, data.current.sparks?.[next.market.symbol], fonts, true);
            next.texture.needsUpdate = true;
          }
          hovered = next;
          renderer.domElement.style.cursor = next ? "pointer" : "grab";
        }
        for (const card of cards) {
          card.lift += ((card.hot ? 1 : 0) - card.lift) * 0.15;
          card.mesh.scale.setScalar(1 + card.lift * 0.06);
          card.mesh.position.y = card.lift * 0.18;
        }
        renderer.render(scene, camera);
        if (firstFrame) {
          firstFrame = false;
          setReady(true);
        }
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        io.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.domElement.removeEventListener("pointerleave", onLeave);
        for (const card of cards) {
          card.texture.dispose();
          (card.mesh.material as InstanceType<typeof THREE.MeshBasicMaterial>).dispose();
        }
        geometry.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        redraw.current = null;
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
    // Rebuilt when the set of markets changes (the listing fallback gives way to the chain's registry); price
    // updates go through `redraw`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets.map((m) => m.symbol).join()]);

  return (
    <div className="relative h-[330px] w-full sm:h-[380px] lg:h-[420px]" data-ready={ready}>
      <div ref={host} className="absolute inset-0 cursor-grab active:cursor-grabbing [mask-image:linear-gradient(90deg,transparent,#000_14%,#000_86%,transparent)]" aria-label="Live markets carousel: drag to spin, click a card to trade" role="img" />
      {/* Edge blur: the cards soften as they swing toward the viewer. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[16%] backdrop-blur-[3px] [mask-image:linear-gradient(90deg,#000,transparent)]" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[16%] backdrop-blur-[3px] [mask-image:linear-gradient(270deg,#000,transparent)]" />
    </div>
  );
}
