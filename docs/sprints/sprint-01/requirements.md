# Sprint 1 requirements

Status: in progress (Increment A complete, Increment B complete and verified end to end)
Sprint folder convention: per `VeraTalley Hackathon Requirements v0.2`, section 1.4 - this file
lists the requirement IDs this sprint takes on, plus anything discovered during the sprint.

## Scope: Increment A (Foundation) + Increment B (Thin golden path)

Per section 9 of the requirements doc, these two increments are the "prototype milestone"
proposed for Oct 9.

### Increment A - Foundation

| ID | Requirement | Status |
|---|---|---|
| NFR-03 | No private keys, seed phrases, or API keys in the repository at any point in history. Secret scanning runs in CI. | Done - `.gitignore` excludes all `.env*` files; `contracts/.env.example` and `frontend/.env.local.example` are placeholder-only; `gitleaks` runs in CI on every push/PR. |
| (groundwork) CR-05 | All contracts are verified on Polygonscan. | Groundwork only this sprint - `contracts/scripts/deploy.js` prints the exact `hardhat verify` command to run after an Amoy deployment. Actual verification needs a funded Amoy deployer key and happens when the team runs a real Amoy deploy (not run from this build environment - see `docs/architecture.md`). |
| (groundwork) NFR-06 | A fresh clone runs locally and deploys to Amoy by following only the README. | Local run path is done and verified (`npm ci && npm run contracts:compile && npm run contracts:test && npm run contracts:deploy:local && npm run frontend:dev`). Amoy deploy path is documented in the README; verifying it end-to-end needs a funded test wallet, which is an Increment C/E activity. |

Also built this increment, beyond the three IDs above, because the repo needed it to exist at all:
monorepo scaffold (`contracts/`, `frontend/`, npm workspaces), the sprint folder structure itself,
and the CI workflow (`.github/workflows/ci.yml`) covering lint, contract tests, coverage, Slither,
and secret scanning on every push and pull request.

### Increment B - Thin golden path

| ID | Requirement | Status |
|---|---|---|
| FR-05 | As a voter, I can connect my wallet and be guided onto the right network. | Done - `frontend/lib/network.ts` (`ensureCorrectNetwork`) prompts a chain switch/add via EIP-3326/EIP-3085; `page.tsx` shows an install prompt if no wallet is found. |
| FR-06 | As a voter, I can see the ballot and whether I am eligible. | Done - `page.tsx` reads `VoterRegistry.isEligible` and `ElectionBallot.hasVoted` for the connected account and reflects both in the UI. |
| FR-07 | As a voter, I can cast one vote. | Done - `ElectionBallot.castVote`, wired to the UI's candidate list and "Cast vote" button. |
| FR-08 | As a voter, I am refused if I try to vote twice or am not registered. | Done - contract-level `require` checks with plain-language revert reasons, surfaced in the UI via `describeError`. |
| FR-10 (basic) | As anyone, I can see a live tally while voting is open. | Done at basic level - the UI polls the public tally every 5 seconds via a read-only provider, so it works with no wallet connected. |
| CR-02 | Only an election's own admin can change its state, register voters, or certify it. | Done for this sprint's two contracts - `onlyAdmin` modifier, `admin` set `immutable` at construction. Full "no account, including the deployer, has authority over elections it did not create" story lands with `ElectionFactory` in Increment C; this sprint has a cross-contract isolation test proving a second `ElectionBallot`'s admin has no authority over the first. |
| CR-03 | Every state change, voter registration, vote, and certification emits an event. | Done for this sprint's scope - `VoterRegistered`, `VotingOpened`, `VotingClosed`, `VoteCast`. `ResultsCertification` events are Increment D. |
| CR-06 | Contract tests cover every Must requirement, including failure cases. | Done - 20 Hardhat tests covering double vote, unregistered voter, wrong state, non-admin caller, and cross-election admin isolation. Coverage: 100% statements/lines/functions, 93.33% branches (target was 90%+). |

## What this sprint deliberately leaves for later increments

Per the sequence in section 9, these are not gaps - they are scoped to a later increment by design:

- `ElectionFactory` and the fully permissionless "create your own election" flow - Increment C.
- `ResultsCertification` and the public verification/recompute page - Increment D.
- Admin UI for creating an election and managing the voter allowlist through the app (FR-01 to
  FR-04) - Increment C.
- Vote receipts with a Polygonscan link (FR-09), demo seed script polish (FR-15/16) - Increment D.
- A live Amoy deployment and Vercel hosting - needs a funded deployer wallet and a Vercel account
  connected to the repository, both of which are the team's to set up (see `docs/architecture.md`
  "Deploying beyond local" for the exact commands once that's in place).

## Discovered during this sprint

Nothing that changes a requirement's scope or acceptance criteria. One implementation detail worth
recording for future sprints: npm workspaces hoist the `solc` package to the repo root's
`node_modules`, so `contracts/hardhat.config.cjs` resolves it with `require.resolve("solc/package.json")`
rather than a hardcoded path - anyone adding another workspace package that touches Hardhat should
keep that in mind.
