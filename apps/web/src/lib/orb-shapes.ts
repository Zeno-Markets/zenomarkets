/// The shapes the landing page's 3D logo (components/zeno/LogoOrb.tsx) rebuilds itself into, one per section. Each
/// shape is a list of voxels in a unit space (about -1 to 1 on every axis), plus the rotation it is best seen at.
/// Pure data, so it is tested without WebGL (orb-shapes.test.ts).

export type OrbShape = "logo" | "cards" | "ring" | "lattice" | "candles" | "wave" | "stairs" | "modules";

/// Voxels in the logo. Every shape uses at most this many; the spare ones hide.
export const N = 448;
// Palette slots: 0 lime, 1 lime shaded, 2 olive, 3 ink, 4 paper.
export type Voxel = [x: number, y: number, z: number, size: number, tone: number];
export interface Frame {
  pos: Float32Array;
  size: Float32Array;
  tone: Uint8Array;
  rot: [number, number, number];
}
export interface Shape {
  dynamic: boolean;
  build: (time: number) => { voxels: Voxel[]; rot: [number, number, number] };
}

export const shapes: Record<OrbShape, Shape> = {
  // The mark: a square ring split into two chevrons, turned 45 degrees into a diamond, the two halves a voxel apart in
  // depth so they read as interlocked when the logo turns.
  logo: {
    dynamic: true,
    build: (t) => {
      const G = 16;
      const T = 5;
      const s = (2 / (G * Math.SQRT2)) * 0.98;
      const voxels: Voxel[] = [];
      const c45 = Math.SQRT1_2;
      for (let r = 0; r < G; r++) {
        for (let c = 0; c < G; c++) {
          if ((r === 0 || r === G - 1) && (c === 0 || c === G - 1)) continue;
          const upper = r < T || (c >= G - T && r >= T && r <= G - T - 2);
          const lower = r >= G - T || (c < T && r >= T + 1 && r < G - T);
          if (!upper && !lower) continue;
          const x0 = (c - (G - 1) / 2) * s;
          const y0 = ((G - 1) / 2 - r) * s;
          const x = (x0 - y0) * c45;
          const y = (x0 + y0) * c45;
          for (const layer of [0.5, 1.5]) voxels.push([x, y, (upper ? 1 : -1) * layer * s, s * 0.92, upper ? 0 : 1]);
        }
      }
      return { voxels, rot: [0.12 * Math.sin(t * 0.5), 0.5 * Math.sin(t * 0.6), 0] };
    },
  },
  // Three cards fanned out, ink, lime and olive, each with a lime header band.
  cards: {
    dynamic: false,
    build: () => {
      const s = 0.1;
      const voxels: Voxel[] = [];
      for (const k of [-1, 0, 1]) {
        const angle = -k * 0.45;
        for (let r = 0; r < 10; r++) {
          for (let c = 0; c < 7; c++) {
            for (const l of [0, 1]) {
              const lx = (c - 3) * s;
              const ly = (4.5 - r) * s;
              const lz = (l - 0.5) * s;
              const x = lx * Math.cos(angle) + lz * Math.sin(angle) + k * 0.6;
              const z = -lx * Math.sin(angle) + lz * Math.cos(angle) - Math.abs(k) * 0.25;
              const tone = k === 0 ? 0 : r < 2 ? 0 : k < 0 ? 3 : 2;
              voxels.push([x, ly - Math.abs(k) * 0.06, z, s * 0.9, tone]);
            }
          }
        }
      }
      return { voxels, rot: [0.08, 0, 0] };
    },
  },
  // A ring in the screen plane round the market universe, with a lime band running round it.
  ring: {
    dynamic: true,
    build: (t) => {
      const M = 56;
      const voxels: Voxel[] = [];
      const band = Math.floor(t * 9);
      for (let j = 0; j < M; j++) {
        const a = (j / M) * Math.PI * 2 + t * 0.3;
        const lit = (j + band) % 14 < 5;
        for (const rr of [0, 1]) {
          for (let h = 0; h < 4; h++) {
            const R = 0.93 + (rr - 0.5) * 0.105;
            voxels.push([Math.cos(a) * R, Math.sin(a) * R, (h - 1.5) * 0.1, 0.092, lit ? 0 : rr ? 2 : 1]);
          }
        }
      }
      return { voxels, rot: [0.25 * Math.sin(t * 0.5), 0.3 * Math.sin(t * 0.4), 0] };
    },
  },
  // A lattice cube: the surface points of an 8 x 8 x 8 grid, lime on the edges.
  lattice: {
    dynamic: true,
    build: (t) => {
      const G = 8;
      const s = 0.2;
      const voxels: Voxel[] = [];
      for (let i = 0; i < G; i++) {
        for (let j = 0; j < G; j++) {
          for (let k = 0; k < G; k++) {
            const edges = [i, j, k].filter((v) => v === 0 || v === G - 1).length;
            if (!edges) continue;
            const o = (G - 1) / 2;
            voxels.push([(i - o) * s, (j - o) * s, (k - o) * s, edges >= 2 ? 0.12 : 0.085, edges >= 2 ? 0 : 2]);
          }
        }
      }
      return { voxels, rot: [0.55, t * 0.45, 0] };
    },
  },
  // Seven candles on an up trend: lime bodies up, ink bodies down, a thin wick through each.
  candles: {
    dynamic: true,
    build: (t) => {
      const s = 0.09;
      const bars: [number, number][] = [
        [-5, -2],
        [-2, -4],
        [-4, 0],
        [0, -2],
        [-2, 3],
        [3, 2],
        [2, 6],
      ];
      const voxels: Voxel[] = [];
      bars.forEach(([open, close], k) => {
        const x = (k - 3) * 0.3;
        const up = close > open;
        const lo = Math.min(open, close);
        const hi = Math.max(open, close);
        for (let y = lo; y < hi; y++) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) voxels.push([x + a * s, y * s, b * s, s * 0.92, up ? 0 : 3]);
        for (let y = lo - 2; y < lo; y++) voxels.push([x, y * s, 0, s * 0.5, up ? 2 : 3]);
        for (let y = hi; y < hi + 2; y++) voxels.push([x, y * s, 0, s * 0.5, up ? 2 : 3]);
      });
      return { voxels, rot: [0.15, -0.25 + 0.25 * Math.sin(t * 0.4), 0] };
    },
  },
  // A rolling surface of 21 x 21 voxels, seen from above: prices as terrain.
  wave: {
    dynamic: true,
    build: (t) => {
      const G = 21;
      const s = 0.095;
      const voxels: Voxel[] = [];
      for (let i = 0; i < G; i++) {
        for (let k = 0; k < G; k++) {
          const x = (i - (G - 1) / 2) * s;
          const z = (k - (G - 1) / 2) * s;
          const y = 0.22 * Math.sin(2.4 * x + t * 1.4) * Math.cos(2.1 * z + t * 0.9);
          voxels.push([x, y, z, s * 0.82, y > 0.06 ? 0 : y > -0.06 ? 2 : 3]);
        }
      }
      return { voxels, rot: [0.9, 0.35 * Math.sin(t * 0.3), 0] };
    },
  },
  // A staircase of six columns: each release a step up, the top of every step lime.
  stairs: {
    dynamic: true,
    build: (t) => {
      const s = 0.1;
      const voxels: Voxel[] = [];
      for (let k = 0; k < 6; k++) {
        const h = (k + 1) * 2;
        for (let y = 0; y < h; y++) for (let w = 0; w < 2; w++) for (let d = 0; d < 3; d++) voxels.push([(k * 2 + w - 5.5) * s, (y - 5.5) * s, (d - 1) * s, s * 0.92, y === h - 1 ? 0 : k % 2 ? 2 : 3]);
      }
      return { voxels, rot: [0.35, -0.6 + 0.2 * Math.sin(t * 0.4), 0] };
    },
  },
  // Six modules on a 3 x 2 lattice in isometric view, one lifting at a time, like the contract blocks below them.
  modules: {
    dynamic: true,
    build: (t) => {
      const s = 0.11;
      const voxels: Voxel[] = [];
      const lifted = Math.floor(t * 0.7) % 6;
      const lift = 0.16 * Math.sin(((t * 0.7) % 1) * Math.PI);
      for (let m = 0; m < 6; m++) {
        const cx = ((m % 3) - 1) * 0.5;
        const cz = (Math.floor(m / 3) - 0.5) * 0.5;
        const dy = m === lifted ? lift : 0;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) voxels.push([cx + i * s, j * s + dy, cz + k * s, s * 0.94, j === 1 ? 0 : 3]);
      }
      return { voxels, rot: [0.62, 0.785 + 0.15 * Math.sin(t * 0.3), 0] };
    },
  },
};

export function frameOf(shape: Shape, time: number, into?: Frame): Frame {
  const { voxels, rot } = shape.build(time);
  const frame = into ?? { pos: new Float32Array(N * 3), size: new Float32Array(N), tone: new Uint8Array(N), rot };
  frame.rot = rot;
  for (let i = 0; i < N; i++) {
    // Spare voxels sit, unseen, inside a real one, so they grow out of the shape when the next shape needs them.
    const v = voxels[i % voxels.length]!;
    frame.pos[i * 3] = v[0];
    frame.pos[i * 3 + 1] = v[1];
    frame.pos[i * 3 + 2] = v[2];
    frame.size[i] = i < voxels.length ? v[3] : 0;
    frame.tone[i] = v[4];
  }
  return frame;
}

