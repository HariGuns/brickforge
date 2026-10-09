# Component library

109 reusable sub-builds (one JSON file each) saved from real generation runs. Before designing a sub-build, the planners search this folder and reuse a component that fits instead of paying to design it again (see "Component library" in the README).

Every component here passes the placement gate (`npm run check-components`): it's valid on its own, has no structural warnings, and holds when it stands on a baseplate and on a plate.

## Hand-fixed

| Component | Replaces | What changed |
|---|---|---|
| `lamp_post_6e7e2b` | `lamp_post_b0bf21` | The original pole was one 1×1×6 round brick (18 plates) on a single stud, a weak joint once placed on studs. The lower half is now 2×2 (a round plate and two round bricks) with 12 plates of 1×1 above it; 18 plates tall instead of 20. Its `handFixed` field records this. |

## Left out

`components-quarantine/` (not in the repo) holds components set aside so planners can't reuse them:
- `lamp_post_b0bf21`: failed the placement gate (replaced by the hand fix above).
- `clock_tower_05c36d`: valid, but a repair had removed its clock faces.

Each component records the request it came from (`source.request`) and what designing it cost (`cost`, USD).
