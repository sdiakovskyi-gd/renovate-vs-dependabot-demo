# Actual run results

Snapshot of the first live run, taken **2026-08-24 ~07:35 UTC**, before the
`renovate.json` grouping rewrite. Recorded here because applying grouping closes
and recreates every Renovate branch, which would otherwise destroy the evidence.

Repo: <https://github.com/sdiakovskyi-gd/renovate-vs-dependabot-demo>

## Headline

| | Renovate | Dependabot |
|---|---|---|
| PRs opened | 12 | 14 |
| **PRs failing CI** | **0** | **4** |
| Merged with no human action | 1 | 0 |
| Dependency Dashboard | ✅ issue #27 | ✗ none |

## Why 4 Dependabot PRs are red

Dependabot proposed cross-major jumps. Renovate did not, because
`separateMajorMinor` is on by default.

- **#5** `typescript 5.0.4 → 7.0.2`
  ```
  tsconfig.json(5,25): error TS5108: Option 'moduleResolution=node10'
  has been removed. Please remove it from your configuration.
  Process completed with exit code 1
  ```
- **#3** `eslint 8.57.1 → 10.8.1` (major folded into the hand-written `eslint` group)
- **#6** `@typescript-eslint/parser 5.62.0 → 8.67.0`
- **#9** `@typescript-eslint/eslint-plugin 5.62.0 → 8.67.0`

Renovate's handling of the same packages:

- **#19** `update eslint` — `eslint 8.40→8.57.1` + both `@typescript-eslint 5.59→5.62`,
  grouped, CI green, **merged by `app/renovate` at 2026-08-24T07:28:55Z**. No workflow involved.
- **#26** `update eslint (major)` — the 8→10 jump, isolated, labeled `major`, automerge off.

Note Dependabot's own group still split `@typescript-eslint/*` into #6 and #9
despite the hand-written `@typescript-eslint/*` pattern, while Renovate grouped
them with zero config via the `group:monorepos` preset.

## Node base image

- Renovate: `20.11 → 20.20-alpine` (#20) plus `24.19` offered as a separate major (#25).
  Node 24 is Active LTS as of this run.
- Dependabot: `20.11-alpine → 26.7-alpine` (#11). Node 26 is Current, not LTS.

## Custom regex manager

Both from `ARG *_VERSION=` lines in the `Dockerfile`, which belong to no ecosystem:

- **#17** `update dependency pnpm to v10 [security]`
- **#18** `update dependency hadolint to v2.15.1`

Dependabot updated the `FROM` line (#11) and ignored both ARGs entirely.

## Full PR list at snapshot time

### Renovate (12)

| PR | State | Title |
|---|---|---|
| #8 | open | fix(deps): update dependency axios to v1.18.0 [security] |
| #10 | open | fix(deps): update dependency express to v4.20.0 [security] |
| #13 | open | fix(deps): update dependency lodash to v4.18.1 [security] |
| #15 | open | fix(deps): update dependency jsonwebtoken to v9 [security] |
| #17 | open | chore(deps): update dependency pnpm to v10 [security] |
| #18 | open | chore(deps): update dependency hadolint to v2.15.1 |
| #19 | **merged (automerge)** | chore(deps): update eslint |
| #20 | open | chore(deps): update node.js to v20.20.2 |
| #21 | open | chore(deps): update actions/checkout action to v7 |
| #22 | open | chore(deps): update actions/setup-node action to v7 |
| #25 | open | chore(deps): update dependency node to v24 |
| #26 | open | chore(deps): update eslint (major) |

### Dependabot (14)

| PR | CI | Title |
|---|---|---|
| #1 | pass | bump actions/checkout from 4 to 7 |
| #2 | pass | bump actions/setup-node from 4 to 7 |
| #3 | **FAIL** | bump eslint from 8.57.1 to 10.8.1 in the eslint group |
| #4 | pass | bump the prod-minor-and-patch group with 2 updates |
| #5 | **FAIL** | bump typescript from 5.0.4 to 7.0.2 |
| #6 | **FAIL** | bump @typescript-eslint/parser from 5.62.0 to 8.67.0 |
| #7 | pass | bump jsonwebtoken and @types/jsonwebtoken |
| #9 | **FAIL** | bump @typescript-eslint/eslint-plugin from 5.62.0 to 8.67.0 |
| #11 | pass | bump node from 20.11-alpine to 26.7-alpine |
| #12 | pass | bump express and @types/express |
| #14 | pass | bump @types/node from 20.2.5 to 26.2.0 |
| #16 | pass | bump jest and @types/jest |
| #23 | pass | bump lodash from 4.17.20 to 4.18.1 |
| #24 | pass | bump axios from 1.5.0 to 1.18.0 |

## Fair reading

The four red PRs are a **defaults** problem, not a capability gap — adding
`update-types` filters to Dependabot's groups would have prevented them.
The honest claim is narrower and stronger:

> Renovate's defaults were safe here, and where they aren't, there are knobs.
> Dependabot's defaults broke the build, and some of the knobs to fix that
> (dashboard queue, custom managers, lockfile maintenance) do not exist.

---

# Round 2 — the grouping experiment

After the snapshot above, `renovate.json` was rewritten several times to drive PR
count down. What that exercise actually taught is recorded here, because the
failures were more instructive than the successes.

## Collapsing to 3 PRs worked, then broke

Aggressive grouping took Renovate from 25 open PRs to 3. All three were red.

| PR | Failure |
|---|---|
| `security (non-major)` | `pip` `ResolutionImpossible` |
| `security (major)` | `pip` `ResolutionImpossible` |
| `devDependency majors` | `npm ci` `ERESOLVE` |

### Cause 1 — splitting a pin-exact manifest

Security fixes were grouped by update type. Because `requirements.txt` pins exact
versions and has no lockfile, each half was internally inconsistent:

```
security (non-major)   flask==2.0.3  (caps Jinja2<3.1)      + jinja2==3.1.6
security (major)       flask==3.1.3  (needs Jinja2>=3.1.2)  + jinja2==3.0.3
```

Verified locally that all six Python packages bumped **together** resolve cleanly and
`worker.py` still imports under `flask 3` / `urllib3 2`.

A second, subtler version of the same bug survived the first fix: setting `groupName`
to a single value is **not** enough, because `separateMajorMinor` defaults to `true`
and puts majors on their own branch under the same group name. `separateMajorMinor:
false` on the pip rule is what actually forces one branch.

### Cause 2 — grouping majors

```
npm error Found: typescript@7.0.2
npm error peer typescript@">=4.8.4 <6.1.0" from @typescript-eslint/parser@8.65.0
```

One unadoptable major took seven unrelated updates down with it. TypeScript 7 is
ahead of its ecosystem; no grouping or waiting fixes that. `allowedVersions: "<6.1.0"`
suppresses the update so the PR is never raised.

## The rule that came out of it

> Group by the unit the dependency resolver operates on. Never group majors.
> Suppress updates that cannot resolve rather than shipping a permanently red PR.

| Ecosystem | Safe to split? | Why |
|---|---|---|
| npm | ✅ | `package-lock.json` regenerated per update |
| gomod | ✅ | resolves transitively |
| **pip (`requirements.txt`)** | ❌ | exact pins, no resolver step |
| Maven | ❌ | no lockfile |

The production fix for Python is to adopt `pip-compile`, `uv` or Poetry so Renovate
regenerates a full lock and partial bumps stop being representable.

## Where it landed

The final config favours **mergeable over minimal**: per-package security PRs
(Python excepted), non-major grouped per manager, majors isolated behind an
expiring approval gate. More PRs than the 3-PR experiment, and they merge.

## A migration cost worth knowing

Changing grouping on a repo that already has open PRs leaves duplicates behind.
Renovate does not treat "this package moved into a different group" as making the
old branch stale while its PR is still open, so old and new coexist until the old
ones are closed by hand. Budget for one cleanup pass per grouping change.
