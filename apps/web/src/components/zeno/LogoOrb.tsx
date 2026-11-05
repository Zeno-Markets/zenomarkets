"use client";

import { useEffect } from "react";
import mark from "@/assets/zeno-mark.png";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { THEME_LIME, THEME_LOGO_GLINT, THEME_LOGO_RIM } from "@/lib/theme-colors";
import { MARK_OUTLINE } from "@/lib/zeno-mark-outline";

/// The ZENOMARKETS mark as one real 3D object, made from the mark itself: a slab cut to the exact outline of its two
/// chevrons (traced from public/zeno-glass.png by scripts/trace-mark.py), the glass artwork of that same image on its
/// face, seen over black as on the app icon's tile, lime glass on its sides, and a clear lacquer that catches light as
/// it turns. It lives on one fixed WebGL layer above the landing page and glides between `OrbSlot` boxes, one per
/// section, as the page scrolls: it sits on the slot nearest the middle of the screen and eases continuously toward
/// the next one, making one full turn per section so it always arrives face on.
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
const smoothstep = (from: number, to: number, v: number) => {
  const x = clamp01((v - from) / (to - from));
  return x * x * (3 - 2 * x);
};

export function LogoOrb() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      let art: InstanceType<typeof THREE.Texture>;
      try {
        art = await new THREE.TextureLoader().loadAsync("/zeno-glass.png");
      } catch {
        return; // No artwork: the fallback marks stay.
      }
      if (disposed) {
        art.dispose();
        return;
      }

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
      // A dark studio with a few narrow light strips: the lacquer reflects thin cream streaks as the logo turns, not a
      // bright room that would wash the artwork out.
      const studio = new THREE.Scene();
      studio.background = new THREE.Color(0, 0, 0);
      const stripGeometry = new THREE.PlaneGeometry(1, 1);
      const strips: [w: number, h: number, x: number, y: number, z: number, roll: number, power: number, colour: string][] = [
        // Almost straight ahead: as the logo sways, this one sweeps a diagonal streak across its face.
        [16, 0.9, 0.8, 1.6, 9, 0.75, 2.6, THEME_LOGO_GLINT],
        [12, 2, 3, -4, 8, -0.7, 0.7, THEME_LOGO_RIM],
        [9, 0.5, -3, 4, 7, 0.65, 4, THEME_LOGO_GLINT],
        [7, 0.35, 5, 1.5, 6, -0.45, 2.5, THEME_LOGO_GLINT],
        [12, 1.2, 0, 9, 0, 0, 1.4, THEME_LOGO_GLINT],
        [10, 6, -7, -3, -5, 0, 0.5, THEME_LOGO_RIM],
      ];
      for (const [w, h, x, y, z, roll, power, colour] of strips) {
        const strip = new THREE.Mesh(stripGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(power), side: THREE.DoubleSide, toneMapped: false }));
        strip.scale.set(w, h, 1);
        strip.position.set(x, y, z);
        strip.lookAt(0, 0, 0);
        strip.rotateZ(roll);
        studio.add(strip);
      }
      scene.environment = pmrem.fromScene(studio, 0.02).texture;
      stripGeometry.dispose();
      studio.traverse((node) => (node as InstanceType<typeof THREE.Mesh>).material && ((node as InstanceType<typeof THREE.Mesh>).material as InstanceType<typeof THREE.Material>).dispose());
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      camera.position.set(0, 0, 30);
      const key = new THREE.DirectionalLight(THEME_LOGO_GLINT, 1.2);
      key.position.set(-5, 7, 9);
      scene.add(key);
      const glow = new THREE.PointLight(THEME_LIME, 30, 0, 1.4);
      glow.position.set(6, -4, 5);
      scene.add(glow);

      // The face: the glass artwork, premultiplied so its translucent glass reads over black, as on the icon's tile.
      // Cap UVs of an extruded shape are its own x, y, so the texture is mapped straight from the outline's unit
      // space back onto the image.
      const { size, cx, cy, r, pieces } = MARK_OUTLINE;
      art.colorSpace = THREE.SRGBColorSpace;
      art.premultiplyAlpha = true;
      art.anisotropy = renderer.capabilities.getMaxAnisotropy();
      art.repeat.set(r / size, r / size);
      art.offset.set(cx / size, 1 - cy / size);
      const face = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0, 0, 0),
        emissive: new THREE.Color(1, 1, 1),
        emissiveMap: art,
        roughness: 0.06,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMapIntensity: 0.9,
        toneMapped: false,
      });
      const side = new THREE.MeshPhysicalMaterial({
        color: THEME_LOGO_RIM,
        emissive: THEME_LOGO_RIM,
        emissiveIntensity: 0.45,
        roughness: 0.18,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.2,
      });
      const depth = 0.1;
      const geometries = pieces.map((flat) => {
        const shape = new THREE.Shape();
        for (let i = 0; i < flat.length; i += 2) {
          if (i === 0) shape.moveTo(flat[0]!, flat[1]!);
          else shape.lineTo(flat[i]!, flat[i + 1]!);
        }
        shape.closePath();
        const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
        geometry.translate(0, 0, -depth / 2);
        return geometry;
      });
      const logo = new THREE.Group();
      // An extruded shape's first material group is its two caps, the second its sides.
      for (const geometry of geometries) logo.add(new THREE.Mesh(geometry, [face, side]));
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
          // The slot pair around the middle of the screen, and how far the middle has moved from one to the next. A
          // smoothstep over the middle 70% of the way: the logo lingers by its section while it is read, then drifts
          // to the next on a curve with no corners, so it never sits still and then dashes.
          const vc = height / 2;
          let i = 0;
          while (i < slots.length - 1 && slots[i + 1]!.cy <= vc) i++;
          const a = slots[i]!;
          const b = slots[Math.min(i + 1, slots.length - 1)]!;
          const t = a === b || vc <= a.cy ? 0 : smoothstep(0.15, 0.85, (vc - a.cy) / (b.cy - a.cy));
          const target = { x: a.cx + (b.cx - a.cx) * t, y: a.cy + (b.cy - a.cy) * t, size: a.size + (b.size - a.size) * t, turn: (i + t) * Math.PI * 2 };
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
        for (const geometry of geometries) geometry.dispose();
        face.dispose();
        side.dispose();
        art.dispose();
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
