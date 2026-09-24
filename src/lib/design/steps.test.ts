import { describe, expect, it } from "vitest";
import { designSteps } from "./steps";
import { compileDesign } from "./compile";
import { designFromModel } from "./schema";
import { SAMPLE_VILLAGE } from "../fixtures/designs";
import { SAMPLE_HOUSE } from "../fixtures/samples";
import { validate } from "../validate/validator";
import { checkStepOrder } from "../steps/steps";

describe("design steps", () => {
  const d = designSteps(SAMPLE_VILLAGE);

  it("builds sub-builds first (children before parents), then the main build", () => {
    expect(d.sections.map((s) => [s.sub, s.copies])).toEqual([
      ["hut", 2],
      ["pine_tree", 4],
      ["grove", 1],
      [null, 1],
    ]);
    expect(d.sections.flatMap((s) => s.steps.map((x) => x.n))).toEqual(Array.from({ length: d.sections.flatMap((s) => s.steps).length }, (_, i) => i + 1));
  });

  it("each sub-build section is that sub-build on its own, fully covered by its steps", () => {
    const hut = d.sections[0];
    expect(hut.model.parts).toHaveLength(7);
    expect(hut.steps.flatMap((s) => s.parts).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(checkStepOrder(hut.model, validate(hut.model).connections, hut.steps)).toEqual([]);
    // The grove adds its two trees as copies in one step.
    const grove = d.sections[2];
    expect(grove.steps.map((s) => s.copies.map((c) => `${c.name}×${c.count}`))).toEqual([[], ["Pine tree×2"]]);
  });

  it("the main build places each copy whole, in a valid bottom-up order", () => {
    const main = d.sections.at(-1)!;
    const all = main.steps.flatMap((s) => s.parts).sort((a, b) => a - b);
    expect(all).toEqual(d.compiled.model.parts.map((_, i) => i));
    expect(main.steps[0].copies).toEqual([]);
    expect(main.steps.flatMap((s) => s.copies.map((c) => `${c.name}×${c.count}`))).toEqual(["Pine tree×2", "Hut×2", "Grove×1"]); // back-to-front within a layer
    // A copy goes on as one piece, so parts may rest on parts of the same copy in the same step.
    const top = new Map<number, number>();
    for (const inst of d.compiled.instances.filter((i) => i.parent === -1)) for (const p of inst.parts) top.set(p, inst.index);
    const stepOf = new Map<number, number>();
    for (const st of main.steps) for (const p of st.parts) stepOf.set(p, st.n);
    const conns = validate(d.compiled.model).connections;
    const bad = d.compiled.model.parts.flatMap((p, i) => {
      if (p.y === 0) return [];
      const ok = conns.some((c) => c.upper === i && (stepOf.get(c.lower)! < stepOf.get(i)! || (stepOf.get(c.lower) === stepOf.get(i) && top.has(i) && top.get(c.lower) === top.get(i))));
      return ok ? [] : [i];
    });
    expect(bad).toEqual([]);
    expect(d.mainSteps.map((s) => s.n)).toEqual(main.steps.map((_, i) => i + 1));
  });

  it("a flat model is a single main section", () => {
    const flat = designSteps(designFromModel(SAMPLE_HOUSE), compileDesign(designFromModel(SAMPLE_HOUSE)));
    expect(flat.sections.map((s) => s.sub)).toEqual([null]);
    expect(flat.sections[0].steps.flatMap((s) => s.parts)).toHaveLength(26);
  });
});
