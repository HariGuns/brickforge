/** Repair-round prompt: tells Claude what the validator found. Tune freely. */
import type { Issue, IssueCode } from "../validate/validator";

/** Short fix hints per error type, appended once per type present. */
const HINTS: Partial<Record<IssueCode, string>> = {
  OVERLAP: "Move or resize one of the two parts (for a sideways copy, mount it on another side stud, or use a brick with side studs instead of a bracket); don't delete planned copies. Remember slopes fill their whole box and rot 90/270 swaps the footprint.",
  FLOATING: "Put the part directly on studs of a part below it (its y must equal that part's top), or add a supporting part underneath. Side-by-side contact does not connect.",
  UNSUPPORTED: "Rest the part on studs of a part below it. A part can't hang from the underside of a part above.",
  DISCONNECTED: "Tie the section to the main structure with parts that span both (e.g. a plate or brick across the gap), or bond it via the base layer.",
  OUT_OF_BOUNDS: "Shift the whole model (or the part) back inside the build area.",
  TOO_MANY_PARTS: "Use larger parts or simplify details.",
  UNKNOWN_PART: "Use only part ids from the parts table.",
  UNKNOWN_COLOR: "Use only colors from the color list.",
  INVALID_OUTPUT: "Return valid JSON matching the schema.",
  BASEPLATE_NOT_ON_GROUND: "A baseplate is the ground layer: put it at y=0 in the main build and build on its studs; it can't be raised or stacked.",
  FEATURE_REMOVED: "Don't delete planned parts or copies to make an error go away. Put back what you removed, then fix it in place: move it, re-attach it with glue parts, or put a wider part under it.",
  WEAK_JOINT: "The part holds too much on one stud. Don't delete it: make the lower part wider (e.g. a tall 1×1 post becomes 2×2 round bricks at the bottom, with at most 12 plates of 1×1 on top), or or bond it to neighbours so more studs clutch it; split tall single-stud stacks with plates that tie into the rest.",
  OVERSTRESSED: "The weight sits too far from the studs holding it. Add support closer to the weight (a pillar or a wider part underneath), shorten the overhang, or clutch it with more studs near the load.",
  DETACHED_SUBBUILD: "Move the copy so its bottom sits on studs of the model, or add glue parts that tie it in.",
  SUBBUILD_UNSUPPORTED: "A copy is placed as one piece, so its bottom must sit on studs below it (or the ground), not hang from something above.",
  INTERLOCKED: "Two copies each sit on the other. Merge them into one sub-build or change heights so one is fully below the other.",
  MOUNT_INVALID: "A sideways copy's mount must name one of the same build's own parts that has side studs (by index), one of its side studs (0-based, as in its part row), and an o cell of the panel's back. Fix the copy with setCopies.",
  SIDEWAYS_DETACHED: "A sideways part touches no stud: its back must clip onto a side stud (or its studs take a part). Move its mount to a side stud, or add a side-stud brick or bracket where it sits.",
};

export function repairPrompt(errors: Issue[], warnings: Issue[], opts: { round: number; maxErrors?: number; diff?: { listing: string; instructions: string } } = { round: 1 }): string {
  const max = opts.maxErrors ?? 60;
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
  const summary = [...counts].map(([c, n]) => `${n}× ${c}`).join(", ");
  const listed = errors.slice(0, max).map((e) => `- [${e.code}] ${e.message}`);
  if (errors.length > max) listed.push(`- … and ${errors.length - max} more errors of the same kinds.`);
  const hints = [...counts.keys()].filter((c) => HINTS[c as IssueCode]).map((c) => `- ${c}: ${HINTS[c as IssueCode]}`);
  const warn = warnings.length
    ? `\n\nWarnings (fix if easy, not required):\n${warnings.slice(0, 15).map((w) => `- ${w.message}`).join("\n")}`
    : "";

  return `The buildability check found ${errors.length} error(s): ${summary}. Part numbers (#n) are indices into your parts array (0-based).

${listed.join("\n")}

How to fix:
${hints.join("\n")}${warn}

${
    opts.diff
      ? `Your last answer, with indices:\n${opts.diff.listing}\n\nFix these problems and nothing else; make sure your fixes don't create new overlaps or gaps. ${opts.diff.instructions}`
      : "Return the complete corrected model (all parts, not just the changed ones). Keep the design and everything that was already fine; change only what is needed to fix these problems, and make sure your fixes don't create new overlaps or gaps."
  }`;
}
