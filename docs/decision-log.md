# Decision log

Fields match `decision_log.xlsx`'s convention per section 11.3 of the requirements doc: ID, date,
status, decision, context, alternatives, consequences, owner. Out-of-scope items from section 4.2
are logged here once the team agrees to them - starting with OOS-14, which the requirements doc
explicitly asks to have logged.

## DEC-01

| Field | Value |
|---|---|
| Date | 2026-10-02 (requirements doc v0.2) |
| Status | Accepted |
| Decision | No in-app system admin / platform-superuser role (OOS-14). |
| Context | The production design has a question of whether the platform needs a system admin above election admins - e.g. to approve who may create elections, manage election admins, or intervene in a running election. |
| Alternatives considered | (a) A platform superuser role with pause/override authority over any election. (b) A deployer-managed allowlist of addresses permitted to create elections, with no further power over elections once created. |
| Consequences | `ElectionFactory` (Increment C) is permissionless: any address can call `createElection(...)` and becomes that election's sole admin. No account, including whoever deployed the factory, has authority over an election it did not create. This is the core of the project's trust story ("nobody has to be trusted") and removes an entire category of UI, contract permissions, and tests that would never appear on the golden path. If spam/abuse becomes a real concern later, alternative (b) is the lightest fix and was scoped as a possible Should requirement for Increment C, not built this sprint. |
| Owner | Tom |

## DEC-02

| Field | Value |
|---|---|
| Date | 2026-10-03 |
| Status | Accepted |
| Decision | Sprint 1 is scoped to Increment A (Foundation) + Increment B (Thin golden path), matching the "prototype milestone" the requirements doc proposes for Oct 9. |
| Context | The requirements doc (section 9) breaks delivery into five increments (A-E) with calendar anchors but leaves sprint boundaries to the team. Needed a concrete, buildable first slice. |
| Alternatives considered | (a) Increment A alone (foundation only, no working vote yet). (b) Increment A+B (this decision) - also includes a fully working, tested cast-a-vote-and-get-refused-on-repeat flow. (c) A+B+C, which would add `ElectionFactory` and the admin UI in the same sprint. |
| Consequences | Sprint 1 ships two of the eventual four contracts (`VoterRegistry`, `ElectionBallot`), deployed directly rather than through a factory, with a hard-coded single election - matching the doc's own description of Increment B ("minimal ElectionBallot and VoterRegistry with a hard-coded election"). `ElectionFactory` and the admin-facing election-creation UI (FR-01 to FR-04) move to Sprint 2 / Increment C. |
| Owner | Anusha (implementer), confirmed with Tom's go-ahead to build toward the hackathon spec. |
