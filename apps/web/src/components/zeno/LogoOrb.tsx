"use client";

import { useEffect } from "react";
import mark from "@/assets/zeno-mark.png";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { THEME_LIME, THEME_OLIVE, THEME_PAPER } from "@/lib/theme-colors";

/// The ZENOMARKETS mark as one real 3D object: the two interlocking chevrons extruded with rounded, bevelled edges in
/// glossy lime glass, lit by a studio environment. It lives on one fixed WebGL layer above the landing page and glides
/// between `OrbSlot` boxes, one per section, as the page scrolls: it always sits on the slot nearest the middle of the
/// screen and eases continuously toward the next one, turning half a turn per section on the way.
///
/// The layer never takes a click, renders only while the tab is visible and is not mounted under reduced motion. Each
/// slot shows a flat fallback mark until the first frame draws; then `data-orb="on"` on <html> hides them (globals.css).

/// An empty box the 3D logo docks into. Size and place it like an image; the logo fits its shorter side. `fallback` is
/// the flat image shown until the 3D layer runs.
export function OrbSlot({ className = "", fallback = mark.src }: { className?: string; fallback?: string }) {
  return (
    <div data-orb-slot aria-hidden className={`pointer-events-none ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fallback} alt="" className="orb-fallback size-full object-contain" />
    </div>
  );
}

interface Slot {
  cx: number;
  cy: number;
  size: number;
}

/// The docking boxes in page order. Boxes hidden at this width (display: none) have no size and are skipped.
function readSlots(): Slot[] {
  const slots: Slot[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-orb-slot]")) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    slots.push({ cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, size: Math.min(rect.width, rect.height) });
  }
  return slots;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

export function LogoOrb() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        return; // No WebGL: the fallback marks stay.
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
      const canvas = renderer.domElement;
      canvas.setAttribute("aria-hidden", "true");
      Object.assign(canvas.style, { position: "fixed", inset: "0", zIndex: "30", pointerEvents: "none" });
      document.body.appendChild(canvas);

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      scene.environment = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      camera.position.set(0, 0, 30);
      const key = new THREE.DirectionalLight(THEME_PAPER, 1.6);
      key.position.set(-5, 7, 9);
      scene.add(key);
      const rim = new THREE.PointLight(THEME_LIME, 30, 0, 1.4);
      rim.position.set(6, -4, 5);
      scene.add(rim);

      // The mark in a square frame: two L-shaped bands, the top + right band and its half-turn twin, a slit apart at
      // two corners. Turned 45 degrees it is the diamond of the logo, the top + right band becoming the upper chevron.
      const T = 0.42;
      const gap = 0.1;
      const upper: [number, number][] = [
        [-1, 1],
        [1, 1],
        [1, -1 + T + gap],
        [1 - T, -1 + T + gap],
        [1 - T, 1 - T],
        [-1, 1 - T],
      ];
      const radii = [0.16, 0.34, 0.14, 0.14, 0.08, 0.14];
      const rounded = (points: [number, number][]) => {
        const shape = new THREE.Shape();
        points.forEach(([x, y], i) => {
          const [px, py] = points[(i - 1 + points.length) % points.length]!;
          const [nx, ny] = points[(i + 1) % points.length]!;
          const r = radii[i]!;
          const toPrev = Math.hypot(px - x, py - y);
          const toNext = Math.hypot(nx - x, ny - y);
          const ax = x + ((px - x) / toPrev) * r;
          const ay = y + ((py - y) / toPrev) * r;
          if (i === 0) shape.moveTo(ax, ay);
          else shape.lineTo(ax, ay);
          shape.quadraticCurveTo(x, y, x + ((nx - x) / toNext) * r, y + ((ny - y) / toNext) * r);
        });
        shape.closePath();
        return shape;
      };
      const extrude = { depth: 0.24, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.085, bevelSegments: 10, curveSegments: 18 };
      const geometryA = new THREE.ExtrudeGeometry(rounded(upper), extrude);
      const geometryB = new THREE.ExtrudeGeometry(
        rounded(upper.map(([x, y]) => [-x, -y])),
        extrude,
      );
      for (const geometry of [geometryA, geometryB]) geometry.translate(0, 0, -extrude.depth / 2);

      const material = new THREE.MeshPhysicalMaterial({
        color: THEME_LIME,
        // Glossy candy glass: a clear lacquer over lime, studio reflections, a faint glow. No transmission: refraction
        // costs a full-screen render pass per frame, too much for a phone, for a difference hardly visible here.
        roughness: 0.16,
        metalness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        sheen: 0.4,
        sheenColor: new THREE.Color(THEME_OLIVE),
        emissive: new THREE.Color(THEME_LIME),
        emissiveIntensity: 0.06,
        envMapIntensity: 1.3,
      });
      const pieceA = new THREE.Mesh(geometryA, material);
      const pieceB = new THREE.Mesh(geometryB, material);
      // The two halves sit a little apart in depth, so the logo reads as interlocked when it turns.
      pieceA.position.z = 0.07;
      pieceB.position.z = -0.07;
      const diamond = new THREE.Group();
      diamond.add(pieceA, pieceB);
      diamond.rotation.z = Math.PI / 4;
      // Square frame half-width 1 is about 1.5 across the diamond with the bevel: scale it to fit a unit radius.
      diamond.scale.setScalar(1 / 1.5);
      const logo = new THREE.Group();
      logo.add(diamond);
      scene.add(logo);

      let width = 0;
      let height = 0;
      const resize = () => {
        width = window.innerWidth;
        height = window.innerHeight;
        renderer.setSize(width, height, false);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      };
      resize();
      window.addEventListener("resize", resize);

      const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
      const onPointer = (event: PointerEvent) => {
        pointer.x = (event.clientX / Math.max(width, 1)) * 2 - 1;
        pointer.y = (event.clientY / Math.max(height, 1)) * 2 - 1;
      };
      window.addEventListener("pointermove", onPointer, { passive: true });

      const state = { ready: false, x: 0, y: 0, size: 0, turn: 0 };
      let last = performance.now();
      let raf = 0;

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (document.hidden) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const slots = readSlots();
        logo.visible = slots.length > 0;
        if (slots.length) {
          // The slot pair around the middle of the screen, and how far the middle has moved from one to the next. The
          // easing spans the whole distance, so the logo never sits still and then dashes: it drifts the whole way.
          const vc = height / 2;
          let i = 0;
          while (i < slots.length - 1 && slots[i + 1]!.cy <= vc) i++;
          const a = slots[i]!;
          const b = slots[Math.min(i + 1, slots.length - 1)]!;
          const t = a === b || vc <= a.cy ? 0 : easeInOutSine(clamp01((vc - a.cy) / (b.cy - a.cy)));
          const target = { x: a.cx + (b.cx - a.cx) * t, y: a.cy + (b.cy - a.cy) * t, size: a.size + (b.size - a.size) * t, turn: (i + t) * Math.PI };
          if (!state.ready) Object.assign(state, target, { ready: true });
          // Exponential follow: frame-rate independent, no overshoot, no step when the scroll speed changes.
          const k = 1 - Math.exp(-dt * 7);
          state.x += (target.x - state.x) * k;
          state.y += (target.y - state.y) * k;
          state.size += (target.size - state.size) * k;
          state.turn += (target.turn - state.turn) * (1 - Math.exp(-dt * 4));
        }
        pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt * 5));
        pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt * 5));

        // Screen pixels to world units on the z = 0 plane, where the logo sits.
        const perPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z) / Math.max(height, 1);
        logo.position.set((state.x - width / 2) * perPx, -(state.y - height / 2) * perPx, 0);
        logo.scale.setScalar((state.size / 2) * perPx);
        const time = now / 1000;
        logo.rotation.set(0.18 * Math.sin(time * 0.5) + pointer.sy * 0.3, state.turn + 0.35 * Math.sin(time * 0.6) + pointer.sx * 0.45, 0);
        renderer.render(scene, camera);
        if (document.documentElement.dataset.orb !== "on") document.documentElement.dataset.orb = "on";
      };
      raf = requestAnimationFrame(tick);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        window.removeEventListener("pointermove", onPointer);
        delete document.documentElement.dataset.orb;
        geometryA.dispose();
        geometryB.dispose();
        material.dispose();
        scene.environment?.dispose();
        pmrem.dispose();
        renderer.dispose();
        canvas.remove();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [reduced]);

  return null;
}
