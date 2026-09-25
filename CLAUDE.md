@AGENTS.md

# Standing rules

- Propose a plan for any significant change and wait for approval.
- Build and test against the simulated Claude first. Live API runs only when needed, always with a budget cap: stop and report if it's reached.
- Run all tests and the 7 regression snapshots after every change. Upright behaviour must stay identical unless a change is approved.
- Commit after each phase and report briefly: whether it worked, what changed, what it cost. No long breakdowns.
- Settled decisions: high effort for design, assembly and photo comparison (tested, medium lost quality); medium for sub-build design and repairs; Auto uses sub-builds for High and Very high; sideways building on; keep the launcher and the AppImage.
- Don't remove features or scripts without asking.
