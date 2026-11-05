"use client";

import { useEffect } from "react";
import mark from "@/assets/zeno-mark.png";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { N, frameOf, shapes, type Frame, type OrbShape } from "@/lib/orb-shapes";
import { THEME_INK, THEME_LIME, THEME_OLIVE, THEME_PAPER } from "@/lib/theme-colors";

export type { OrbShape };

/// The ZENOMARKETS mark built from a few hundred lime voxels, on one fixed WebGL layer above the landing page. Each
/// section carries an `OrbSlot`: an empty box in its layout that names a shape. As the visitor scrolls, the voxels
/// leave one slot, fly to the next and rebuild themselves into that slot's shape: the logo in the hero, three cards
/// beside the products, a ring round the market universe, and so on, back to the logo at the end.
///
/// The layer never takes a click (`pointer-events: none`), it only renders while the tab is visible, and it is not
/// mounted at all under reduced motion. Until it draws its first frame each slot shows a flat fallback mark; once it
/// runs it sets `data-orb="on"` on <html>, which hides those fallbacks (globals.css).

/// An empty box the 3D logo docks into. Size and place it like an image; the logo fits its shorter side. `fallback` is
/// the flat image shown until the 3D layer runs (an empty string shows nothing).
export function OrbSlot({ shape, className = "", fallback = mark.src }: { shape: OrbShape; className?: string; fallback?: string }) {
  return (
    <div data-orb-slot={shape} aria-hidden className={`pointer-events-none ${className}`}>
      {fallback ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fallback} alt="" className="orb-fallback size-full object-contain" />
      ) : null}
    </div>
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, v: number) => {
  const x = clamp01((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

interface Slot {
  shape: OrbShape;
  cx: number;
  cy: number;
  size: number;
}

/// Reads the docking boxes in page order. Hidden boxes (display: none at this width) have no size and are skipped.
function readSlots(): Slot[] {
  const slots: Slot[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-orb-slot]")) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const shape = el.dataset.orbSlot as OrbShape;
    slots.push({ shape: shape in shapes ? shape : "logo", cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, size: Math.min(rect.width, rect.height) });
  }
  return slots;
}

export function LogoOrb() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        return; // No WebGL: the fallback marks stay.
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const canvas = renderer.domElement;
      canvas.setAttribute("aria-hidden", "true");
      Object.assign(canvas.style, { position: "fixed", inset: "0", zIndex: "30", pointerEvents: "none" });
      document.body.appendChild(canvas);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      camera.position.set(0, 0, 30);
      scene.add(new THREE.HemisphereLight(THEME_PAPER, THEME_INK, 1.6));
      const key = new THREE.DirectionalLight(THEME_PAPER, 2.2);
      key.position.set(-4, 6, 8);
      scene.add(key);
      const rim = new THREE.PointLight(THEME_LIME, 40, 0, 1.6);
      rim.position.set(5, -3, 6);
      scene.add(rim);

      const palette = [new THREE.Color(THEME_LIME), new THREE.Color(THEME_LIME).lerp(new THREE.Color(THEME_OLIVE), 0.35), new THREE.Color(THEME_OLIVE), new THREE.Color(THEME_INK), new THREE.Color(THEME_PAPER)];
      const geometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.16);
      const material = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.12 });
      const mesh = new THREE.InstancedMesh(geometry, material, N);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      const group = new THREE.Group();
      group.add(mesh);
      scene.add(group);

      // Per-voxel randomness: when it sets off, which way it drifts in flight and how it tumbles.
      const delay = new Float32Array(N);
      const scatter = new Float32Array(N * 3);
      const tumble = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        delay[i] = Math.random() * 0.4;
        const a = Math.random() * Math.PI * 2;
        const b = Math.acos(2 * Math.random() - 1);
        scatter.set([Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)], i * 3);
        tumble.set([(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6], i * 2);
      }

      const cache = new Map<OrbShape, Frame>();
      const frameFor = (shape: OrbShape, time: number, scratch: Frame | undefined) => {
        const def = shapes[shape];
        if (def.dynamic) return frameOf(def, time, scratch);
        let frame = cache.get(shape);
        if (!frame) cache.set(shape, (frame = frameOf(def, 0)));
        return frame;
      };
      let scratchA: Frame | undefined;
      let scratchB: Frame | undefined;

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

      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      const state = { g: -1, x: 0, y: 0, size: 0 };
      let last = performance.now();
      let raf = 0;
      let announced = false;

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (document.hidden) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const time = now / 1000;
        const slots = readSlots();
        if (slots.length === 0) {
          group.visible = false;
          renderer.render(scene, camera);
          return;
        }
        group.visible = true;

        // Where the viewport centre sits between two docking boxes: `g` counts slots, its fraction is the trip.
        const vc = height / 2;
        let i = 0;
        while (i < slots.length - 1 && slots[i + 1]!.cy <= vc) i++;
        const a = slots[i]!;
        const b = slots[Math.min(i + 1, slots.length - 1)]!;
        const raw = a === b || vc <= a.cy ? 0 : clamp01((vc - a.cy) / (b.cy - a.cy));
        // Stay docked for the first and last quarter of the way, so the logo sits still while its section is read.
        const trip = smoothstep(0.25, 0.75, raw);
        const target = { g: i + trip, x: a.cx + (b.cx - a.cx) * trip, y: a.cy + (b.cy - a.cy) * trip, size: a.size + (b.size - a.size) * trip };
        if (state.g < 0) Object.assign(state, target);
        const follow = 1 - Math.exp(-dt * 9);
        state.g += (target.g - state.g) * (1 - Math.exp(-dt * 5));
        state.x += (target.x - state.x) * follow;
        state.y += (target.y - state.y) * follow;
        state.size += (target.size - state.size) * follow;

        const pair = Math.min(Math.floor(state.g), slots.length - 1);
        const morph = state.g - pair;
        const from = frameFor(slots[pair]!.shape, time, scratchA);
        const to = frameFor(slots[Math.min(pair + 1, slots.length - 1)]!.shape, time, scratchB);
        if (shapes[slots[pair]!.shape].dynamic) scratchA = from;
        if (shapes[slots[Math.min(pair + 1, slots.length - 1)]!.shape].dynamic) scratchB = to;

        for (let v = 0; v < N; v++) {
          const e = easeInOut(clamp01((morph - delay[v]!) / 0.6));
          const flight = Math.sin(Math.PI * e);
          const spread = 0.45 * flight;
          dummy.position.set(
            from.pos[v * 3]! + (to.pos[v * 3]! - from.pos[v * 3]!) * e + scatter[v * 3]! * spread,
            from.pos[v * 3 + 1]! + (to.pos[v * 3 + 1]! - from.pos[v * 3 + 1]!) * e + scatter[v * 3 + 1]! * spread,
            from.pos[v * 3 + 2]! + (to.pos[v * 3 + 2]! - from.pos[v * 3 + 2]!) * e + scatter[v * 3 + 2]! * spread,
          );
          dummy.rotation.set(tumble[v * 2]! * flight, tumble[v * 2 + 1]! * flight, 0);
          dummy.scale.setScalar(from.size[v]! + (to.size[v]! - from.size[v]!) * e);
          dummy.updateMatrix();
          mesh.setMatrixAt(v, dummy.matrix);
          color.copy(palette[from.tone[v]!]!).lerp(palette[to.tone[v]!]!, e);
          mesh.setColorAt(v, color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        // Screen pixels to world units on the z = 0 plane, where the group sits.
        const perPx = (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z) / Math.max(height, 1);
        group.position.set((state.x - width / 2) * perPx, -(state.y - height / 2) * perPx, 0);
        // In flight it shrinks by up to half, so passing over a section covers as little of it as possible.
        const inFlight = Math.sin(Math.PI * clamp01(morph));
        group.scale.setScalar((state.size / 2) * perPx * (1 - 0.45 * inFlight));
        pointer.sx += (pointer.x - pointer.sx) * follow;
        pointer.sy += (pointer.y - pointer.sy) * follow;
        const m = easeInOut(clamp01(morph));
        group.rotation.set(
          from.rot[0] + (to.rot[0] - from.rot[0]) * m + pointer.sy * 0.25,
          from.rot[1] + (to.rot[1] - from.rot[1]) * m + pointer.sx * 0.4,
          from.rot[2] + (to.rot[2] - from.rot[2]) * m,
        );
        renderer.render(scene, camera);
        if (!announced) {
          announced = true;
          document.documentElement.dataset.orb = "on";
        }
      };
      raf = requestAnimationFrame(tick);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        window.removeEventListener("pointermove", onPointer);
        delete document.documentElement.dataset.orb;
        geometry.dispose();
        material.dispose();
        mesh.dispose();
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
