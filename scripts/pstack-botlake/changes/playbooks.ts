import type { FileEdit } from "../model.ts";

/** Playbook-level runtime adaptation: same engineering steps, lake operations. */
export function playbookChanges(): FileEdit[] {
	return [
		{
			skill: "poteto-mode",
			target: "./playbooks/autonomous-run.md",
			intent: "Replace the Cursor /loop wake mechanism with bounded lake observations whose records distinguish timeout from progress, and replace AskQuestion with the operator conversation, so an unattended run has real evidence and no unavailable command.",
			ops: [
				{
					kind: "replace",
					anchor: "2. Pick the wake mechanism using Cursor's `/loop` command (a built-in, not a pstack skill). An event to watch (CI, a merge, a ref advancing) gets a watcher subagent that wakes you on the event, with a long time-based heartbeat as fallback. No event gets a fixed-interval heartbeat sized to when the result is worth re-checking. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"2. Pick the observation mechanism from the lake (see [`../references/botlake-tools.md`](../references/botlake-tools.md)). An event to watch (CI, a merge, a ref advancing) gets a watcher run started with `bl agent start`; its brief records the observation in work notes before it settles. Await the watcher or the work condition with a bounded `bl await`, then inspect the record. With no event, make one bounded observation sized to when the result is worth re-checking. A wait returns `reason=satisfied` or `reason=timeout`; check it, re-read this playbook and the work records, then decide whether to observe again. A timeout is not progress, failure, or a cadence. Never leave an unbounded poll. Choose each delegate's seat and effort per poteto-mode's Delegates section.",
				},
				{
					kind: "replace",
					anchor: "Do not park reversible work for the human or use `AskQuestion`.",
					replacement:
						"Do not park reversible work for the human or stop to ask in chat.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/session-pickup.md",
			intent: "Read the prior trail from lake agent and work records instead of a Cursor transcript directory, while keeping the transcript as an optional harness pointer.",
			ops: [
				{
					kind: "replace",
					anchor: "1. Locate the prior trail. A local transcript under the active workspace's `agent-transcripts/` directory (the system prompt names the path. Do not glob across `~/.cursor/projects/*/`, that crosses workspace boundaries and reads private chats from unrelated projects), a cloud-agent URL, or a pushed branch. Read the metadata overview and last messages first, then scan back for the decision points. Parse a long transcript in a subagent and keep the reduced timeline in the main thread (the **principle-guard-the-context-window** skill). Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"1. Locate the prior trail. The lake records are the trail: `bl agent list`, `bl agent show RUN_ID`, `bl agent activity peek RUN_ID`, and `bl work show <id> --history`, with the mechanism map in [`../references/botlake-tools.md`](../references/botlake-tools.md). Read the work notes and criteria first, then the run's last events, then scan back for the decision points. A native transcript is optional: use only the pointer this harness names for the run, never a global transcript directory. Read the pushed branch too. Parse a long record in a small run and keep the reduced timeline in the main thread (the **principle-guard-the-context-window** skill). Choose each run's seat and effort per poteto-mode's Delegates section.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/pause-safely.md",
			intent: "Cancel lake runs rather than Cursor subagents, and record the resume point in the work notes so a replacement run inherits it.",
			ops: [
				{
					kind: "replace",
					anchor: "Start nothing new, and cancel any nested subagents.",
					replacement:
						"Start nothing new, and cancel any nested agent runs (`bl agent cancel RUN_ID`; see [`../references/botlake-tools.md`](../references/botlake-tools.md)).",
				},
				{
					kind: "replace",
					anchor: "If a show-me-your-work trail exists, point at it instead of duplicating it.",
					replacement:
						'If a show-me-your-work trail exists, point at it instead of duplicating it. Record the same resume point with `bl work update <id> --notes "<resume point, verified state, next action>"` so a replacement run inherits it through the lake, not the chat.',
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/worktree-cleanup.md",
			intent: "Base in-use checks on live worktrees, lake agent records, processes, and the operator's pinned set. The deleted transcript auditor no longer supplies chat evidence; deletion follows wktree's branch safety and explicit authorization for untracked data.",
			ops: [
				{
					kind: "replace",
					anchor: "1. Snapshot and audit. Record `df -h /`, then run `scripts/worktree-audit.sh [-b <pr-base-ref>] [repo-path]` (principle-build-the-lever). Without `-b` it checks `MERGED` against `origin/HEAD`, so pass `-b origin/<branch>` when PRs target another branch. It reads paths from `git worktree list`, never hand-typed, since a hand-typed `myrepo-worktrees/x` misses one that lives at `.cursor/worktrees/myrepo/x` (principle-encode-lessons-in-structure). It classifies each worktree by size, age, merge state, uncommitted work, PR state, and the newest chat that touched it, then suggests a bucket. The transcript scan is slow, so background it.",
					replacement:
						"1. Snapshot and audit. Record `df -h /`, then read paths from `wktree list --json`, never hand-typed (principle-encode-lessons-in-structure). Run `wktree -h` before unfamiliar operations. For each worktree record size (`du -sh`), age, merge state against `origin/HEAD` or the PR's explicit base ref, uncommitted work (`git status --porcelain`), and branch. Cross-check the lake: `bl agent list` and `bl agent show RUN_ID` show a run's state and `--cwd` (see [`../references/botlake-tools.md`](../references/botlake-tools.md)), and `lsof +D <path>` shows a process holding the tree. Suggest a bucket from that evidence.",
				},
				{
					kind: "replace",
					anchor: "2. The bucket is advice, not permission. The pinned and active chats are the real artifact (principle-prove-it-works). Get that set from the user or sidebar and cross-check every candidate. The lever has marked `safe` a worktree the user had pinned, so the pinned set wins.",
					replacement:
						"2. The bucket is advice, not permission. The real in-use set is the lake's active agent records, processes holding a path, and any worktrees the operator explicitly pinned (principle-prove-it-works). Cross-check every candidate. A heuristic can mark a pinned tree safe, so direct evidence wins.",
				},
				{
					kind: "replace",
					anchor: "3. Verify usage before deleting. For every `verify-recent-chat` row, or anything you doubt, fan subagents out to read the transcripts and report whether the chat is pinned or ongoing and which worktrees it touches (principle-guard-the-context-window, transcripts are bulk). A pinned chat spawns arena and repro trees into sibling worktrees via background subagents, and those are in use even when their names never hit the sidebar. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"3. Verify usage before deleting. For anything you doubt, check a live run whose `--cwd` is inside the tree, a process holding it, and the operator's pinned set. A pinned or running run may have arena and repro trees in sibling worktrees; those are in use even when their names never appear in a list. Choose the inspection run's seat per poteto-mode's Delegates section.",
				},
				{
					kind: "replace",
					anchor: "4. Pause on irreversible loss. `wip:N` is N tracked uncommitted edits. Show the diff and get a decision first, since removing a clean worktree is recoverable from its branch but uncommitted work is gone. `scratch:N` is untracked throwaway, safe to drop, but name the files. Per Autonomy, clean and merged and not-in-use proceeds. `wip` and in-use pause.",
					replacement:
						"4. Pause on irreversible loss. `wip:N` is N tracked uncommitted edits. Show the diff and get a decision first, because uncommitted work is gone after removal. `scratch:N` is untracked data: name the files and get explicit confirmation unless the operator already authorized that exact candidate set. Per Autonomy, a clean, integrated, not-in-use tree may proceed. `wip`, unapproved scratch data, and in-use trees pause.",
				},
				{
					kind: "replace",
					anchor: "Xcode `DerivedData` and `iOS DeviceSupport`, `~/Library/Application Support/Cursor` (`state.vscdb.backup`, and `snapshots/roots/<root>` where a `<root>` named for a folder you opened as a workspace balloons), package caches (pnpm, uv, brew, yarn).",
					replacement:
						"Xcode `DerivedData` and `iOS DeviceSupport`, editor state and snapshot caches, package caches (pnpm, uv, brew, yarn).",
				},
				{
					kind: "replace",
					anchor: "5. Prune the confirmed set. Per path, `git worktree remove --force <path>`. If the dir survives on ignored build artifacts, `rm -rf` it, then `git worktree prune`.",
					replacement:
						"5. Prune the confirmed set with `wktree remove --branch <branch>`, or `--self` when removing the checkout you are operating in. Let wktree prove the branch is safe; use `--keep-branch` when the checkout should disappear but the branch must remain, and use `--integrated-into <origin/ref>` for a clean squash-merged branch when appropriate. If ignored build artifacts survive after a successful removal, remove that leftover directory. Confirm with `df -h /` and re-list.",
				},
				{
					kind: "replace",
					anchor: "Branch refs survive, so no commits are lost. Confirm with `df -h /` and re-list.",
					replacement: "",
				},
				{
					kind: "replace",
					anchor: "**Reply:** `df -h /` before and after with space reclaimed, the worktrees pruned, and a one-line reason for each held back (in-use by which chat, or uncommitted work).",
					replacement:
						"**Reply:** `df -h /` before and after with space reclaimed, the worktrees pruned, and a one-line reason for each held back (active run or process, operator pin, uncommitted work, or unapproved scratch data).",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/visual-parity.md",
			intent: "Replace the Cursor /loop repetition with bounded comparison passes against the baseline and name the project verification driver instead of a generic external control skill.",
			ops: [
				{
					kind: "replace",
					anchor: "via image diff on the matching surface via the control skill.",
					replacement:
						"via image diff on the matching surface through the project's verification skill or named driver.",
				},
				{
					kind: "replace",
					anchor: "Investigate the pixel delta. `/loop` per component until the diff is zero.",
					replacement:
						"Investigate the pixel delta. Re-run the bounded comparison per component until the diff is zero, keeping each pass's artifact (see [`../references/botlake-tools.md`](../references/botlake-tools.md)).",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/runtime-forensics.md",
			intent: "Name the project verification skill rather than an uninstalled control skill, and use lake run seats for artifact parsing.",
			ops: [
				{
					kind: "replace",
					anchor: "1. Capture the live signal on the matching surface via the control skill: a CPU profile for a spinning process, a heap snapshot for a leak, a CDP trace for a visual glitch. A real artifact, not a guess.",
					replacement:
						"1. Capture the live signal on the matching surface through the project's `verify-*` skill or a named driver: a CPU profile for a spinning process, a heap snapshot for a leak, a CDP trace for a visual glitch. A real artifact, not a guess. See [`../references/botlake-tools.md`](../references/botlake-tools.md) for starting and observing the runs that do the parsing.",
				},
				{
					kind: "replace",
					anchor: "Parse large artifacts in a subagent (the **guard-the-context-window** principle skill), keep the reduced finding in the main thread. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"Parse large artifacts in a small agent run (the **guard-the-context-window** principle skill), keep the reduced finding in the main thread. Choose the run's seat and effort per poteto-mode's Delegates section.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/trace-forensics.md",
			intent: "Parse captured artifacts in lake runs with a chosen seat instead of Cursor subagent fields.",
			ops: [
				{
					kind: "replace",
					anchor: "Parse large artifacts in a subagent (the **principle-guard-the-context-window** skill) and keep the reduced finding in the main thread. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"Parse large artifacts in a small agent run (the **principle-guard-the-context-window** skill) and keep the reduced finding in the main thread. Choose the run's seat and effort per poteto-mode's Delegates section; mechanics are in [`../references/botlake-tools.md`](../references/botlake-tools.md).",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/autopilot-full.md",
			intent: "Owners become worktree agent runs, audit cycles use bounded observation without treating silence as liveness proof, and uninstalled slop and control skills become project verification plus the inline slop-strip rule.",
			ops: [
				{
					kind: "replace",
					anchor: "Each owner is a Cursor cloud agent that builds, opens its PR per `playbooks/opening-a-pr.md`",
					replacement:
						"Each owner is a Botlake agent run in its own worktree that builds, opens its PR per `playbooks/opening-a-pr.md`",
				},
				{
					kind: "replace",
					anchor: "The code is ready only after the slop-strip (the `deslop` skill from the `cursor-team-kit` plugin (`/deslop`)) and the `/no-comments` pass",
					replacement:
						"The code is ready only after the slop-strip per **Comments** and the `/no-comments` pass",
				},
				{
					kind: "replace",
					anchor: "Soon after starting, push and start a decision trail in the root agent's store (path in the system prompt) per the **show-me-your-work** skill, then push each finished unit before you start the next. Whoever spawns a subagent records its id, state, and a stuck-after runtime from past runs of its kind in that store, so the root can probe it if the parent dies.",
					replacement:
						"Assume a run can stop without its parent. Soon after starting, push and start a decision trail per the **show-me-your-work** skill, and keep the owner's task notes current with `bl work update <id> --notes`. Push each finished unit before you start the next. Whoever starts a run records its id, state, next expected checkpoint, and a task-specific review horizon in the work notes, so the root can inspect the run from lake records and branch side effects if its parent stops.",
				},
				{
					kind: "replace",
					anchor: "prove the load-bearing behavior live on the real surface through its control skill (such as `control-ui` or `control-cli` from `cursor-team-kit`) or a named driver",
					replacement:
						"prove the load-bearing behavior live on the real surface through the project's `verify-*` skill or a named driver",
				},
				{
					kind: "replace",
					anchor: "On the operator's go, arm `/loop 1h` to audit until no delegated work is left, because long runs drift and agents stall silently.",
					replacement:
						"On the operator's go, begin the audit observation cycle: make one bounded observation of up to an hour, inspect the work and run records, then decide whether to re-arm while delegated work remains (see [`../references/botlake-tools.md`](../references/botlake-tools.md)). This is active observation, not a durable scheduler or proof that a quiet run is stuck.",
				},
				{
					kind: "replace",
					anchor: "An agent is stuck when it errors, cannot start turns, or shows nothing new past its stuck-after runtime, and so is an owner that has neither pushed nor written a trail row by the first tick. One waiting on you or the operator is not stuck, so answer it. Replace a stuck agent at once, without waiting for its stop to land.",
					replacement:
						"A failed or cancelled run is stopped. A quiet run needs corroboration from its recorded state, outstanding tools, work notes, and branch or PR side effects; one quiet snapshot or timeout is not enough. A run waiting on you or the operator is not stuck, so answer it. When the evidence shows a loop or dead run, cancel it, review the branch state, and assign a replacement without sharing the branch concurrently.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/babysit.md",
			intent: "Replace the Cursor built-in and /loop polling with forge polling re-armed on bounded waits, and name the adapter for wait mechanics.",
			ops: [
				{
					kind: "replace",
					anchor: "This playbook replaces Cursor's built-in babysit skill for these requests, so do not route there even though its description matches the same words.",
					replacement:
						"This playbook replaces a harness-provided babysit helper for these requests, so do not route there even though its description matches the same words.",
				},
				{
					kind: "replace",
					anchor: "Run `drive` and `background` under `/loop` in dynamic mode. Rearm the watcher after every push wave and every verdict you act on. Watcher output drives wakeups. Never add a second sleep loop.",
					replacement:
						"Run `drive` and `background` as repeated bounded observations: arm the watcher, wait for its next event, act, then re-arm. Rearm after every push wave and every verdict you act on. Watcher output drives wakeups. Never add a second sleep loop. Wait mechanics and the no-unbounded-poll rule are in [`../references/botlake-tools.md`](../references/botlake-tools.md).",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/multi-phase-plan.md",
			intent: "Settle plan-time delegation on catalog-backed lake runs, remove the remaining hard-coded model slug, name project verification instead of Cursor control skills, and make observation cycles and installed paths real for Botlake.",
			ops: [
				{
					kind: "replace",
					anchor: '3. Explore in subagents with `subagent_type: "poteto-agent"` and an explicit model per the Subagents section (the **guard-the-context-window** principle skill). Pick each subagent\'s reasoning level and fast or standard speed for the job, per the Subagents section.',
					replacement:
						"3. Explore in agent runs using the delegate brief in [`../references/poteto-agent.md`](../references/poteto-agent.md), with a seat and effort per poteto-mode's Delegates section (the **guard-the-context-window** principle skill).",
				},
				{
					kind: "replace",
					anchor: "Ten lanes at the PR head drive the real surface through its control skill, per the **swarm** skill, on the `swarm workers` model (default `grok-4.7-xhigh-fast`).",
					replacement:
						"Ten lanes at the PR head drive the real surface through its project verification skill or named driver, per the **swarm** skill, on the `swarm workers` seat from `.botlake/pstack-roles.md`.",
				},
				{
					kind: "replace",
					anchor: "**Control skill.** Pick it by surface. Browser, Electron, and web UIs use `control-ui` from `cursor-team-kit`. CLIs and TUIs use `control-cli` from `cursor-team-kit`. Native mobile uses whatever simulator-driving skill the repo has. A PR that touches two surfaces gets lanes on both. A surface with no control skill is a risk in Appendix C, and its live block still names how each lane drives it.",
					replacement:
						"**Verification driver.** Pick it by surface. Browser, Electron, and web UIs use the project's `verify-*` skill or a named browser driver. CLIs and TUIs use the same skill's CLI recipe, or a PTY harness. Native mobile uses whatever simulator-driving skill the repo has. A PR that touches two surfaces gets lanes on both. A surface with no driver is a risk in Appendix C, and its live block still names how each lane drives it. Start and observe lane runs per [`../references/botlake-tools.md`](../references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "Unless the operator names a path, write the file under the agent store's `docs/`.",
					replacement:
						"Unless the operator names a path, follow the repository's plan-document convention; when none exists, write `docs/<slug>-plan.md` in the project.",
				},
				{
					kind: "replace",
					anchor: "The program runs `pstack/skills/poteto-mode/playbooks/<execution playbook>.md`.",
					replacement:
						"The program runs `.agents/skills/poteto-mode/playbooks/<execution playbook>.md`.",
				},
				{
					kind: "replace",
					anchor: "  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/<execution playbook>.md`\n  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md`\n  - [ ] `git show origin/main:<control skill path>`\n  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`\n  - [ ] `git show origin/main:pstack/skills/<each other leaf skill the program uses>`",
					replacement:
						"  - [ ] `sed -n '1,400p' .agents/skills/poteto-mode/playbooks/<execution playbook>.md`\n  - [ ] `sed -n '1,400p' .agents/skills/swarm/SKILL.md`\n  - [ ] `sed -n '1,400p' .agents/skills/<verification skill>/SKILL.md`\n  - [ ] `sed -n '1,400p' .agents/skills/poteto-mode/playbooks/opening-a-pr.md`\n  - [ ] `sed -n '1,400p' .agents/skills/<each other leaf skill the program uses>/SKILL.md`",
				},
				{
					kind: "replace",
					anchor: "- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.",
					replacement:
						"- [ ] On the operator's go, begin an active audit observation cycle: one bounded wait of up to an hour, then the audit prompt below. Record the policy in work notes, inspect `reason`, and re-arm only while the coordinator session is active; do not claim a scheduler or cadence.",
				},
				{
					kind: "replace",
					anchor: "- [ ] Run `/deslop` before each commit and `/no-comments` before review.",
					replacement:
						"- [ ] Strip slop per **Comments** before each commit and run `/no-comments` before review.",
				},
				{
					kind: "replace",
					anchor: "Each live lane runs on its own cloud VM at the PR head. Drive through `control-ui` or `control-cli` from `cursor-team-kit`.",
					replacement:
						"Each live lane runs in its own isolated worktree at the PR head, or a fresh container or VM when the surface needs one. Drive through the project's `verify-*` skill.",
				},
				{
					kind: "replace",
					anchor: "<Deliver input only through the control skill's commands. Name the read-only diagnostics.>",
					replacement:
						"<Deliver input only through the verification driver's commands. Name the read-only diagnostics.>",
				},
				{
					kind: "replace",
					anchor: "Record a 30 to 60 second video of the change on a lane VM.",
					replacement:
						"Record a 30 to 60 second video of the change in a lane environment.",
				},
				{
					kind: "replace",
					anchor: "## <Task as a verb phrase> (<PR id>)",
					replacement: "## <Work item as a verb phrase> (<PR id>)",
				},
				{
					kind: "replace",
					anchor: "Ten lanes on `<swarm workers model>` at the PR head, per the boot recipe.",
					replacement:
						"Ten lanes on the `<swarm workers seat>` from `.botlake/pstack-roles.md` at the PR head, per the boot recipe.",
				},
				{
					kind: "replace",
					anchor: "Run each full swarm per `pstack/skills/swarm/SKILL.md`.",
					replacement: "Run each full swarm per `.agents/skills/swarm/SKILL.md`.",
				},
				{
					kind: "replace",
					anchor: "Which PRs get `pstack/skills/how/SKILL.md` and `pstack/skills/interrogate/SKILL.md`. The trail per `pstack/skills/show-me-your-work/SKILL.md`.",
					replacement:
						"Which PRs get `.agents/skills/how/SKILL.md` and `.agents/skills/interrogate/SKILL.md`. The trail per `.agents/skills/show-me-your-work/SKILL.md`.",
				},
				{
					kind: "replace",
					anchor: "node pstack/skills/poteto-mode/scripts/check-plan.mjs <plan.md>",
					replacement: "node .agents/skills/poteto-mode/scripts/check-plan.mjs <plan.md>",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/orchestrate.md",
			intent: "Run the program on lake work records and isolated agent runs instead of Task spawns, the Project store, and cloud VMs; retain authorized repository scripts and use Mail when agent context is useful.",
			ops: [
				{
					kind: "replace",
					anchor: "dozens to hundreds of subagents",
					replacement: "dozens to hundreds of agent runs",
				},
				{
					kind: "replace",
					anchor: "Run it with your own tools. Spawn workers with `Task`. Keep the program's state in the Project tracker (`notes.md`) and the Project store. Watch each PR with PR and CI event subscriptions when your harness has them. Call no scripts, run no polling loops, and never relay messages or status between agents.",
					replacement:
						"Run it with the lake (see [`../references/botlake-tools.md`](../references/botlake-tools.md)). Start workers with `bl agent start` on role seats validated against `bl agent catalog`. Keep the program's durable state in work records: a group, one task per PR, criteria, dependencies, and notes (`bl work`). Watch a PR through the forge (`gh` or `origin pr`) with bounded observations. Wait on peers with `bl await` and coordinate useful agent context with `bl mail`. Run the repository scripts named by the active playbook; do not invent a second coordination loop or relay status through the operator.",
				},
				{
					kind: "replace",
					anchor: "Its kickoff carries everything it needs, including each upstream report it depends on, pasted in full. Workers can't see their siblings. Run workers on a new cloud VM (`environment: \"cloud\"`) unless the work needs this machine: a `control-ui` or `control-cli` runtime check (from `cursor-team-kit`), local transcripts, a simulator, or auth that exists only here. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"Its brief carries the goal, scope, criteria, and upstream reports it needs. Sibling context is not automatic: put durable facts in work notes and use Mail when an existing agent's interpretation or decision trail is useful. Give each worker its own branch and worktree (`wktree add --branch <branch>`) and start it with `--cwd` at `wktree path --branch <branch>`. A check that needs a specific machine (a simulator, a browser session, auth that exists only here) runs in that worktree too. Choose each run's seat and effort per poteto-mode's Delegates section.",
				},
				{
					kind: "replace",
					anchor: "- **Fork when new work needs a worker's built state,** such as its checkout, uncommitted changes, or a running process. Message a worker only for a follow-up on the same work. Never message one to check on it, because a message restarts an idle agent.",
					replacement:
						"- **Choose continuity deliberately.** Start a fresh run for independent work. Use Mail for a focused follow-up when the existing agent's context is useful. Resume with `bl agent resume` when the continuation needs session state such as its checkout, uncommitted changes, or a running process. Never restart a run just to check on it: `bl agent show` and `bl agent activity peek` observe without restarting, and neither a quiet peek nor a wait timeout proves a stall.",
				},
				{
					kind: "replace",
					anchor: "Retry by cause: a smaller scope after a context or memory limit, the same kickoff after a dropped connection, and a different model after a tool error.",
					replacement:
						"Retry by cause: a smaller scope after a context or memory limit, the same kickoff after a dropped connection, and a different catalog-listed seat after a tool error when the role permits it.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/refactoring.md",
			intent: "Delegate mechanical refactoring through the catalog-backed refactoring role instead of the remaining Cursor subagent model slug and speed fields, and name the project verification driver for equivalence proof.",
			ops: [
				{
					kind: "replace",
					anchor: "Delegate the mechanical edits to a subagent using your configured refactoring model (default `grok-4.7-xhigh-fast`) with a specific scope (file paths, the names being moved, the behavior to hold). Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"Delegate the mechanical edits to an agent run on the `refactoring` role seat from `.botlake/pstack-roles.md`, with a specific scope (file paths, the names being moved, the behavior to hold). Choose the run's catalog-backed seat and optional effort per poteto-mode's Delegates section.",
				},
				{
					kind: "replace",
					anchor: "via the relevant control skill.",
					replacement: "via the project's verification skill or named driver.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/feature.md",
			intent: "Delegate on the feature role seat from the Botlake role table and use run language instead of subagent/model fields.",
			ops: [
				{
					kind: "replace",
					anchor: "Delegate code-writing to a subagent using your configured feature model (default `grok-4.7-xhigh-fast`) with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"Delegate code-writing to an agent run on the `feature` role seat from `.botlake/pstack-roles.md`, with a specific scope in its brief (file paths, named data shape and its organizing structure per **principle-model-the-domain**, a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). Choose the run's effort per poteto-mode's Delegates section; start and observe it per [`../references/botlake-tools.md`](../references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation.",
					replacement:
						"An agent run forbidden to delegate satisfies this by owning the diff directly with the same review separation.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/bug-fix.md",
			intent: "Replace subagent/model defaults and Cursor /loop with lake runs, the role table, and bounded autonomous observation.",
			ops: [
				{
					kind: "replace",
					anchor: "via the control skill (Non-negotiables)",
					replacement: "through the verification driver named in Non-negotiables",
				},
				{
					kind: "replace",
					anchor: "Delegate investigation and the fix to subagents, stay in the lead. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"Delegate investigation and the fix to agent runs, stay in the lead. Choose each run's seat and effort per poteto-mode's Delegates section; the mechanics are in [`../references/botlake-tools.md`](../references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "Drive a long or stubborn hunt with Cursor's `/loop` command.",
					replacement:
						"Drive a long or stubborn hunt with the Autonomous run playbook's bounded waits.",
				},
				{
					kind: "replace",
					anchor: "Delegate implementation to a subagent using your configured bug-fix model (default `grok-4.7-xhigh-fast`) with a specific scope.",
					replacement:
						"Delegate implementation to an agent run on the `bug-fix` role seat from `.botlake/pstack-roles.md`, with a specific scope.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/hillclimb.md",
			intent: "Hillclimb iterations delegate to lake runs on the role seat, with worktree isolation for parallel hypotheses.",
			ops: [
				{
					kind: "replace",
					anchor: "Hand the change to a subagent using your configured hillclimb model (default `grok-4.7-xhigh-fast`) with a tight scope. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"Hand the change to an agent run on the `hillclimb` role seat from `.botlake/pstack-roles.md`, with a tight scope. Choose the run's effort per poteto-mode's Delegates section and see [`../references/botlake-tools.md`](../references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "When several independent hypotheses are live, fan them to parallel subagents, each in its own worktree",
					replacement:
						"When several independent hypotheses are live, fan them to parallel agent runs, each in its own worktree",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/eval.md",
			intent: "Candidates and judges become lake runs on different seats, and chain verification reads agent records rather than assuming a Cursor transcript directory.",
			ops: [
				{
					kind: "replace",
					anchor: "4. **Spawn N parallel candidates** on different models per the **arena** skill's Phase B. Each works in its own sanitized dir. Same prompt to each. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section.",
					replacement:
						"4. **Start N parallel candidate runs** on different seats per the **arena** skill's Phase B. Each works in its own sanitized dir. Same prompt to each. Choose each run's seat and effort per poteto-mode's Delegates section and see [`../references/botlake-tools.md`](../references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "5. **Spawn one blinded judge** on a different model family per the **arena** skill's Phase C.",
					replacement:
						"5. **Start one blinded judge run** on a catalog-listed seat from a different model family when the catalog exposes that distinction, per the **arena** skill's Phase C.",
				},
				{
					kind: "replace",
					anchor: "6. **Verify the chain from transcripts, not self-report.** Read each candidate's local transcript under the active workspace's `agent-transcripts/` directory (the system prompt names this path). Do not glob across `~/.cursor/projects/*/`. That crosses workspace boundaries and reads private chats from unrelated projects. Look at which files each candidate actually opened. Grade chain-following from the files it really read plus the shape of the code, never from the candidate's own claims.",
					replacement:
						"6. **Verify the chain from run records, not self-report.** Use `bl agent show RUN_ID` and `bl agent activity peek RUN_ID` for each candidate, plus the optional native transcript pointer this harness names for that run. Never read another project's history. Look at which files each candidate actually opened. Grade chain-following from the files it really read plus the shape of the code, never from the candidate's own claims.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/opening-a-pr.md",
			intent: "Replace Task worktree rules and the uninstalled Cursor slop skill with isolated workflow runs, one writer per branch, and the inline slop-strip rule.",
			ops: [
				{
					kind: "replace",
					anchor: "**Worktree.** Work from a git worktree off main. Subagents inherit it.",
					replacement:
						"**Worktree.** Work from a worktree off main, created with `wktree add --branch <branch>`; run `wktree -h` first. Agent runs inherit it when you pass the worktree path as `--cwd`.",
				},
				{
					kind: "replace",
					anchor: "Snarled worktree: reset from main, redo minimally.",
					replacement:
						"Snarled worktree: preserve any unreviewed state, create a fresh branch and wktree-managed checkout from main, then redo minimally.",
				},
				{
					kind: "replace",
					anchor: "Multiple `Task` calls on the same branch each get their own worktree, or `git fetch && git reset --hard origin/<branch>` between them.",
					replacement:
						"Concurrent writers get distinct branches and wktree-managed worktrees; never point two writing runs at the same branch. A sequential replacement may reuse the existing branch and checkout only after the prior run settles and its state is reviewed. Start every run with `--cwd` at its assigned checkout; see [`../references/botlake-tools.md`](../references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "Run `/deslop` from `cursor-team-kit` over the diff before commit and `/no-comments` before review.",
					replacement:
						"Strip slop per **Comments** over the diff before commit and run `/no-comments` before review.",
				},
				{
					kind: "replace",
					anchor: "A subagent that opens a PR runs `/deslop` and `/no-comments`, and posts the URL.",
					replacement:
						"An agent run that opens a PR strips slop per **Comments**, runs `/no-comments`, and posts the URL.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/shipping.md",
			intent: "Verifiers become worktree agent runs on the role seats, and the stack watcher is re-armed on bounded waits rather than a Cursor /loop.",
			ops: [
				{
					kind: "replace",
					anchor: "One verifier per PR, each a Cursor cloud agent, runs the change the way a user would with the matching control skill (such as `control-ui` or `control-cli` from `cursor-team-kit`), parent against head",
					replacement:
						"One verifier per PR, each an agent run in its own worktree on the verification seat from `.botlake/pstack-roles.md`, runs the change the way a user would with the project's `verify-*` skill or a named driver, parent against head",
				},
				{
					kind: "replace",
					anchor: "(`scripts/watch-pr/watch-pr --queued-stack --stack-prs <bottom-to-top>`) under `/loop` until it reports `COMPLETE` at the ceiling.",
					replacement:
						"(`scripts/watch-pr/watch-pr --queued-stack --stack-prs <bottom-to-top>`) on a bounded re-arm until it reports `COMPLETE` at the ceiling (see [`../references/botlake-tools.md`](../references/botlake-tools.md)).",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/prototype.md",
			intent: "Name the project verification skill instead of the uninstalled control skill when proving a prototype.",
			ops: [
				{
					kind: "replace",
					anchor: "For a visual decision, screenshot each variant via the control skill and drive the interaction.",
					replacement:
						"For a visual decision, screenshot each variant via the project's `verify-*` skill and drive the interaction (mechanics in [`../references/botlake-tools.md`](../references/botlake-tools.md)).",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/perf-issue.md",
			intent: "Use the project verification skill for the baseline trace and the perf-issue role seat for implementation, instead of Cursor control skills and model slugs.",
			ops: [
				{
					kind: "replace",
					anchor: "1. Capture a baseline trace via the matching control skill.",
					replacement:
						"1. Capture a baseline trace via the project's `verify-*` skill or a named driver.",
				},
				{
					kind: "replace",
					anchor: "Delegate implementation to a subagent using your configured perf-issue model (default `grok-4.7-xhigh-fast`)",
					replacement:
						"Delegate implementation to an agent run on the `perf-issue` role seat from `.botlake/pstack-roles.md` (see [`../references/botlake-tools.md`](../references/botlake-tools.md))",
				},
				{
					kind: "replace",
					anchor: "Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section. Review the diff.",
					replacement:
						"Use the role's catalog-backed optional effort per poteto-mode's Delegates section. Review the diff.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./scripts/check-plan.mjs",
			intent: "Update the plan checker's program markers to the adapted plan: installed skills are read from .agents/skills, and the audit policy is an active bounded observation cycle rather than a Cursor /loop cadence.",
			ops: [
				{
					kind: "replace",
					anchor: 'const PROGRAM_MARKERS = ["git show origin/main:", "/loop 1h", "status message"];',
					replacement:
						'const PROGRAM_MARKERS = [".agents/skills/", "audit observation cycle", "status message"];',
				},
				{
					kind: "replace",
					anchor: '${pr.title}: Verify, live lacks "Ten lanes on \\`<swarm workers model>\\` at the PR head" with the model filled in',
					replacement:
						'${pr.title}: Verify, live lacks "Ten lanes on \\`<swarm workers seat>\\` from the role table at the PR head" with the seat filled in',
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./scripts/check-plan.test.ts",
			intent: "Keep the checker's fixture aligned with the adapted observation-cycle marker so the retained supporting test proves the same plan contract the prose declares.",
			ops: [
				{
					kind: "replace",
					anchor: "\\`git show origin/main:\\` /loop 1h status message",
					replacement: "\\`.agents/skills/\\` audit observation cycle status message",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./playbooks/authoring-a-skill.md",
			intent: "Replace Cursor's built-in create-skill with the project's actual skill-authoring guidance and the shared runtime adapter.",
			ops: [
				{
					kind: "replace",
					anchor: "1. Use the **create-skill** skill (Cursor's built-in for authoring SKILL.md files).",
					replacement:
						"1. Use the project's skill-authoring guidance: the `skillbox-author` skill when installed, otherwise the Agent Skills format and the project's contributing notes. Discover installed skills under `.agents/skills`. When the skill contains runtime instructions, point it at [`../references/botlake-tools.md`](../references/botlake-tools.md) instead of restating lake mechanics.",
				},
			],
		},
	];
}
