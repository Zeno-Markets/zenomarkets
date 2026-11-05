import assert from "node:assert/strict";
import { test } from "node:test";
import { N, frameOf, shapes, type OrbShape } from "./orb-shapes";

const names = Object.keys(shapes) as OrbShape[];

for (const name of names) {
  test(`${name}: fits in the voxel budget, every value finite, inside the slot`, () => {
    for (const time of [0, 1.7, 12.3]) {
      const { voxels, rot } = shapes[name].build(time);
      assert.ok(voxels.length > 0, "at least one voxel");
      assert.ok(voxels.length <= N, `${voxels.length} voxels, budget ${N}: the extra ones would never show`);
      for (const [x, y, z, size, tone] of voxels) {
        for (const v of [x, y, z, size]) assert.ok(Number.isFinite(v), "finite");
        // The shape is drawn at half the slot's size per unit, so past about 1.3 it spills well outside its box.
        assert.ok(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 1.3, `${name} voxel at ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
        assert.ok(size > 0 && size < 0.3, "voxel size");
        assert.ok(Number.isInteger(tone) && tone >= 0 && tone <= 4, "palette slot");
      }
      assert.ok(rot.every(Number.isFinite), "rotation");
    }
  });
}

test("the logo is the mark: two chevrons of equal size, front and back", () => {
  const { voxels } = shapes.logo.build(0);
  const front = voxels.filter((v) => v[2] > 0).length;
  const back = voxels.filter((v) => v[2] < 0).length;
  assert.equal(front, back);
  assert.equal(voxels.length, 412);
});

test("a frame pads to the full budget: real voxels keep their size, spare ones hide inside a real one", () => {
  const { voxels } = shapes.cards.build(0);
  const frame = frameOf(shapes.cards, 0);
  assert.equal(frame.size.length, N);
  for (let i = 0; i < N; i++) {
    if (i < voxels.length) assert.ok(frame.size[i]! > 0);
    else {
      assert.equal(frame.size[i], 0);
      const twin = voxels[i % voxels.length]!;
      assert.deepEqual([frame.pos[i * 3], frame.pos[i * 3 + 1], frame.pos[i * 3 + 2]], [Math.fround(twin[0]), Math.fround(twin[1]), Math.fround(twin[2])]);
    }
  }
});
