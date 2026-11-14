import { readTemplate } from "../apply.ts";
import type { FileEdit } from "../model.ts";

/** Hub skills: the mode, its delegate brief, setup, and help. */
export function coreChanges(): FileEdit[] {
	return [
		{
			skill: "poteto-mode",
			target: "./references/botlake-tools.md",
			intent: "Add the shared Botlake adapter: one mapping from every runtime primitive pstack named (Task fields, cloud agents, model slugs, Project store, transcripts, loops, control skills) to the lake operation that replaces it, so each independently invoked skill points here instead of restating mechanics.",
			content: readTemplate("botlake-tools.md"),
		},
		{
			skill: "poteto-mode",
			target: "./references/poteto-agent.md",
			intent: "Carry the delegate brief in the skill itself. The plugin agent is never installed, so a Botlake run needs the poteto-mode reading contract, the correct installed path, and delegate terminology rather than a Cursor plugin search or subagent identity.",
			copyFrom: "agents/poteto-agent.md",
			ops: [
				{
					kind: "replace",
					anchor: "---\nname: poteto-agent\ndescription: Delegate subagent for code-writing and helper tasks spawned during a `/poteto-mode` run. Use for delegates, not as the runner for `/poteto-mode` itself. Spawn a fresh `poteto-agent` for each new task, and resume one only in the strict cases that poteto-mode's Subagents section names. Reads the `poteto-mode` skill's `SKILL.md` in full before any work, including its inline Principles index. Substituting `generalPurpose` skips that read and drifts.\nis_background: true\n---\n",
					replacement:
						"# Poteto delegate brief\n\nPass this file as the prompt of a fresh Botlake agent run. It is a brief, not an installed agent, so the parent starts the run and owns its scope. Reuse a run only in the cases poteto-mode's Delegates section names.\n",
				},
				{
					kind: "replace",
					anchor: "# Poteto subagent",
					replacement: "# Delegate contract",
				},
				{
					kind: "replace",
					anchor: "You are operating as poteto-mode's full agent style. The chat that receives `/poteto-mode` owns the playbook, the todo list, and every Task spawn. You are one of its delegates. Read the `poteto-mode` skill's `SKILL.md` in full before doing any work, including its inline Principles index. Use the absolute path your parent gave you. With no path, before any other work, search `~/.cursor/plugins/` for a file whose path ends in `skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose `.cursor-plugin/plugin.json` has the highest `version`. Your skill catalog hides this skill, so a missing catalog entry does not mean pstack is absent. If no such file exists, stop and tell your parent. Navigate to a leaf `principle-*` skill whenever you apply that principle.",
					replacement:
						"You are operating as poteto-mode's full agent style. The chat that receives `/poteto-mode` owns the playbook, the todo list, and every agent run. You are one of its delegates. Read the installed `poteto-mode` `SKILL.md` at [`../SKILL.md`](../SKILL.md) in full before doing any work, including its inline Principles index, and read [`botlake-tools.md`](botlake-tools.md) before your first lake command. Navigate to a leaf `principle-*` skill whenever you apply that principle.",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./SKILL.md",
			intent: "Adapt the mode's hub: point at the shared adapter, replace Cursor Task/subagent defaults with catalog-backed lake runs and the role table, preserve useful agent continuity through Mail, and remove Cursor-only control, slop, authoring, and loop instructions.",
			ops: [
				{
					kind: "replace",
					anchor: "description: poteto's agent style for concise, detailed responses, deliberate subagents, unslopped prose, simple code, and verified work. Use for poteto, /poteto-mode, or requests to work in this style.",
					replacement:
						"description: poteto's agent style for concise, detailed responses, deliberate delegation, unslopped prose, simple code, and verified work. Use for poteto, /poteto-mode, or requests to work in this style.",
				},
				{
					kind: "replace",
					anchor: "Bundled skills live at `../<name>/SKILL.md` from this file, so put this file's absolute path in every `poteto-agent` prompt.",
					replacement:
						"Bundled skills live at `../<name>/SKILL.md` from this file, so put this file's absolute path in every delegate's prompt. Runtime operations are in [`references/botlake-tools.md`](references/botlake-tools.md): agent seats and runs, work records, gates, Mail, bounded waits, and transcripts.",
				},
				{
					kind: "replace",
					anchor: "Restate the user's goal in each subagent brief",
					replacement: "Restate the user's goal in each delegate brief",
				},
				{
					kind: "replace",
					anchor: "Route bulk to subagents, keep summaries in the main thread.",
					replacement: "Route bulk to agent runs, keep summaries in the main thread.",
				},
				{
					kind: "replace",
					anchor: "a fleet of subagents under one coordinator",
					replacement: "a fleet of agent runs under one coordinator",
				},
				{
					kind: "replace",
					anchor: "dozens to hundreds of subagents, minimal human turns",
					replacement: "dozens to hundreds of agent runs, minimal human turns",
				},
				{
					kind: "replace",
					anchor: 'About to `AskQuestion` on a "which approach", "how should I", or "what should this do" fork',
					replacement:
						'About to ask the operator in chat on a "which approach", "how should I", or "what should this do" fork',
				},
				{
					kind: "replace",
					anchor: "Agent-facing prose also follows the **create-skill** skill (Cursor's built-in for authoring SKILL.md files).",
					replacement:
						"Agent-facing prose also follows the project's skill-authoring guidance: the `skillbox-author` skill when installed, otherwise the Agent Skills format and the project's contributing notes. Discover installed skills under `.agents/skills`.",
				},
				{
					kind: "replace",
					anchor: "- Before commit → the `deslop` skill from the `cursor-team-kit` plugin (`/deslop`).",
					replacement:
						"- Before commit → strip narration and dead weight per **Comments** and the **unslop** skill. This install has no separate slop skill.",
				},
				{
					kind: "replace",
					anchor: "- Shipping UI / IDE / CLI → the matching control skill. `cursor-team-kit` publishes `control-cli` (CLIs and TUIs) and `control-ui` (browser / Electron / web UIs). For bug fixes, reproduce first on the same surface yourself. Hand to the user only under the narrow Bug fix step 1 exception.",
					replacement:
						"- Shipping UI / IDE / CLI → the matching verification driver: the project's `verify-*` skill or a named driver for that surface. When the project has none, run the **create-verification-skill** skill once and keep its output. `botlake bin run ui` shows work to a person; it never drives the app. For bug fixes, reproduce first on the same surface yourself. Hand to the user only under the narrow Bug fix step 1 exception.",
				},
				{
					kind: "replace",
					anchor: "not Cursor's built-in babysit skill, whose description matches the same words",
					replacement:
						"not a harness-provided PR helper whose description matches the same words",
				},
				{
					kind: "replace",
					anchor: "/loop until X",
					replacement: "run until X",
					expect: 2,
				},
				{
					kind: "replace",
					anchor: "**Just do it.** Use any MCP tool.",
					replacement:
						"**Just do it.** Use any tool this session exposes, including lake commands, project skills, and MCP servers the harness lists. Mail is agent coordination; keep operator updates in this chat rather than sending unsolicited Mail.",
				},
				{
					kind: "range",
					start: "## Subagents\n",
					end: "Say so in both cases.\n\n",
					replacement: `## Delegates and agent runs

You delegate with Botlake agent runs. Start one with \`bl agent start --seat SEAT --cwd <isolated-worktree> --prompt "<complete brief>"\` and keep the returned id. The shared mechanics live in [\`references/botlake-tools.md\`](references/botlake-tools.md); this section owns the pstack defaults.

**Seats and roles.** Read \`.botlake/pstack-roles.md\` for the project's role seats and efforts. Without that table, run \`bl agent catalog\` and choose only a listed seat whose purpose fits the role; no seat name is universally available. Every routed skill (\`how\`, \`why\`, \`interrogate\`, \`reflect\`, \`swarm\`, \`arena\`, \`architect\`) names its roles; honor them instead of overriding every role to one seat. A panel role is a list, so start one run per entry. Use the role's optional effort only when it matches catalog evidence for that seat. Pass \`--model\` only when the operator explicitly chooses a catalog-listed model for that seat. If a start rejects the seat or effort, read the error and inspect the catalog again rather than guessing.

**Defaults for every run.** Give every concurrent writer its own branch and worktree, created with \`wktree add --branch <branch>\`, and pass the absolute path as \`--cwd\`. A full brief in a file, passed as \`--prompt "$(cat brief.md)"\`, never a pointer the run cannot read. Include the original goal, the files the run may write, the named data shape, a checkable done predicate, and the report shape. Judgment, implementation, review, and verification use the seats selected for those roles in the role table; when a line is missing, select by purpose from the live catalog.

**Match the seat to the job.** The role table or live catalog is the source of truth. Do not raise or lower effort from memory. Omit \`--effort\` to use the seat's configured value unless the table records an effort supported by the catalog. Verification keeps its own role. A refused seat is reported, and the calling skill re-reads the catalog. Do not silently substitute one family across a diverse panel.

You own every run's work. Review the diff and write your own summary, don't pass through what it said. A second opinion is the same brief run on a different catalog-listed seat. Agreement is high-signal.

**Continuity and fresh runs.** New independent work gets a fresh run with consolidated scope: the original brief, every later directive, the prior report, and the branch. Use Mail when the existing agent's interpretation, decision trail, or remembered context is useful; a focused follow-up or missing fact can preserve that continuity, and configured delivery may resume a stopped agent. Use \`bl agent resume\` when the continuation needs session state such as its checkout, uncommitted changes, or a process it still runs. A stop order uses \`bl agent cancel\`. A role such as a PR owner can outlive one run; after settlement, either continue through Mail or resume when its state matters, otherwise start a replacement with the consolidated record. Never rely on a bare "done" summary as the handoff.

**Coordination.** Work records carry durable program state: \`bl work\` groups, tasks, criteria, dependencies, and notes. Mail carries useful agent-to-agent context, questions, and handoffs without turning the operator into a relay. A peer question uses \`bl mail send ... --about <task>\`. Wait with bounded \`bl await\` queries and check \`reason\`; a timeout is data, not a stopped run or a cadence. A machine-checkable blocker gets a gate (\`bl gate create ... --dependent <task>\`). Read [\`references/botlake-tools.md\`](references/botlake-tools.md) before using any of these.

`,
				},
				{
					kind: "range",
					start: "You own every subagent's work.",
					end: 'fire a fresh subagent with consolidated scope rather than trusting a "done" summary.\n\n',
					replacement: "",
				},
				{
					kind: "replace",
					anchor: "**Session pickup.** Resuming or taking over a prior agent's in-flight work from a transcript, cloud-agent URL, or pushed branch.",
					replacement:
						"**Session pickup.** Resuming or taking over a prior agent's in-flight work from the lake's agent and work records, or a pushed branch.",
				},
				{
					kind: "replace",
					anchor: "on an explicit pause, going offline, a Cursor restart, or imminent context compaction",
					replacement:
						"on an explicit pause, going offline, a harness restart, or imminent context compaction",
				},
			],
		},
		{
			skill: "setup-pstack",
			target: "./SKILL.md",
			intent: "Replace Cursor model-slug detection and the ~/.cursor rule file with the lake's agent catalog and a project-local role table, so role seats and reasoning effort are real Botlake choices instead of Cursor Task model fields.",
			content: readTemplate("setup-pstack.md"),
			replace: true,
		},
		{
			skill: "poteto-help",
			target: "./SKILL.md",
			intent: "Adapt the help map: install and setup name Skillbox and the lake role table, Cursor mode and /loop guidance becomes Botlake run guidance, and guide links point at the carried upstream pages inside the skill.",
			ops: [
				{
					kind: "replace",
					anchor: 'A message that asks for work, such as "use pstack to fix this bug", is not a help question. Read [`poteto-mode`](../poteto-mode/SKILL.md), do the work under it, and mention once that a Custom Mode keeps it on.',
					replacement:
						'A message that asks for work, such as "use pstack to fix this bug", is not a help question. Read [`poteto-mode`](../poteto-mode/SKILL.md), do the work under it, and mention once that the harness can keep the skill attached.',
				},
				{
					kind: "replace",
					anchor: "The links here point into the installed plugin, which the user may not be able to open, so give the user the file's public copy: `https://github.com/cursor/plugins/blob/main/pstack/` followed by its path.",
					replacement:
						"Links resolve inside the installed skills tree. Carried upstream guide pages live under [`references/upstream/guide/`](references/upstream/guide/README.md), and the shared runtime mapping is [`botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "No `~/.cursor/rules/pstack-models.mdc` means `/setup-pstack` hasn't run for this user, so every role uses its default model.",
					replacement:
						"No `.botlake/pstack-roles.md` means `/setup-pstack` hasn't run for this project, so each invoked skill must choose an available seat by role purpose from `bl agent catalog`.",
				},
				{
					kind: "replace",
					anchor: "When the model rule is missing and it matters, ask whether the user wants to pick a model for each role and a reasoning budget now.",
					replacement:
						"When the role table is missing and it matters, ask whether the user wants to pick a seat for each role and a reasoning budget now.",
				},
				{
					kind: "replace",
					anchor: "or the answer depends on which models run.",
					replacement: "or the answer depends on which seats run.",
				},
				{
					kind: "replace",
					anchor: "Later: answer their question, and add one line saying every role keeps its default model until they run `/setup-pstack`.",
					replacement:
						"Later: answer their question, and add one line saying skills choose available seats by role purpose until they run `/setup-pstack`.",
				},
				{
					kind: "range",
					start: "1. Install with `/add-plugin pstack` in chat, or from Customize in the sidebar.",
					end: "so those parts may not work there.\n",
					replacement: `1. Install the pstack bundle with Skillbox in the project, then run \`skillbox sync\` to generate \`.agents/skills/\`. The bundle README owns the exact commands; this help page only routes questions.
2. Run [\`/setup-pstack\`](../setup-pstack/SKILL.md). It asks for a reasoning budget, maps a seat to each role from \`bl agent catalog\`, and writes \`.botlake/pstack-roles.md\`. The table applies to new agent runs. Then it offers once each to generate a verification skill and a formal verification skill for the project, unless the project already has one.
3. Start a real task with \`/poteto-mode\`, a goal, and a check that can pass or fail.

Installing changes nothing until the user invokes a skill. Only \`/setup-pstack\` is meant to load from the user's words. The [upstream project](https://github.com/cursor/plugins/tree/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack) and the carried [setup guide](references/upstream/guide/01-setup.md) have the background. Offer to word their first prompt with them, per [\`references/prompting.md\`](references/prompting.md).

If cost is the worry, say where the tokens go and how to spend fewer. pstack spends extra tokens on delegated runs and review panels. Rerun \`/setup-pstack\` and pick a smaller budget or cheaper seats. A shorter panel list starts fewer runs, one for each entry. Save \`/poteto-mode\` for work that needs rigor.

pstack started as a Cursor plugin. This bundle adapts its runtime instructions to Botlake: work records, agent runs, Mail, gates, and bounded waits replace Cursor task delegation, hosted agents, persistent modes, and cadence commands. The engineering principles and workflows are unchanged. Where a carried upstream page still describes the original Cursor surface, [\`botlake-tools.md\`](../poteto-mode/references/botlake-tools.md) names the operation to use instead. Read it before following any runtime instruction.
`,
				},
				{
					kind: "range",
					start: "Whether `/poteto-mode` stays on depends on how the user starts it:",
					end: 'spawn it with `subagent_type: "poteto-agent"`.\n',
					replacement: `Whether \`/poteto-mode\` stays in context depends on the harness. Installed skills are available for the session. Name \`/poteto-mode\` in the task prompt when the harness attaches skills by name; a harness with a persistent mode can keep it attached. This install has no separate persistent-mode step. \`/poteto-mode\` starts its delegates as Botlake agent runs on the seats in \`.botlake/pstack-roles.md\`.
`,
				},
				{
					kind: "replace",
					anchor: "| Run parallel checks over slices, or race workers, as cloud agents | [`/swarm`](../swarm/SKILL.md) |",
					replacement:
						"| Run parallel checks over slices, or race workers, in isolated worktrees | [`/swarm`](../swarm/SKILL.md) |",
				},
				{
					kind: "replace",
					anchor: "- `/deslop`, `control-cli`, and `control-ui` ship in the `cursor-team-kit` plugin.\n- `/loop` and `/create-skill` are Cursor built-ins.",
					replacement:
						"- The external control and slop skills named by the upstream plugin are not installed here. Use the project's `verify-*` skill for app surface control, and strip slop inline per poteto-mode's Comments rule.\n- A cadence command does not exist here. The Autonomous run playbook uses bounded `bl await` checks instead.\n- Cursor's skill-authoring built-in is not installed. Use the project's skill-authoring guidance, `skillbox-author` when present.",
				},
				{
					kind: "replace",
					anchor: 'Without `/poteto-mode`, a phrase such as "babysit this pr" can start Cursor\'s own skill for the same job instead.',
					replacement:
						'Without `/poteto-mode`, a phrase such as "babysit this pr" can start the harness\'s own skill for the same job instead.',
				},
				{
					kind: "replace",
					anchor: "pstack has no planning skill. Cursor's Plan Mode works alongside it.",
					replacement:
						"pstack has no planning skill. A harness plan mode works alongside it.",
				},
				{
					kind: "replace",
					anchor: "| The mode stopped applying after a few turns | It was started with Enter. Start it as a Custom Mode, or start each task with `/poteto-mode`. |",
					replacement:
						"| The skill stopped applying after a few turns | The harness dropped it from context. Name `/poteto-mode` again, or use the harness's persistent-mode setting. |",
				},
				{
					kind: "replace",
					anchor: "| Pick a model for each role and a reasoning budget | [`/setup-pstack`](../setup-pstack/SKILL.md) |",
					replacement:
						"| Pick a catalog seat for each role and a reasoning budget | [`/setup-pstack`](../setup-pstack/SKILL.md) |",
				},
				{
					kind: "replace",
					anchor: "| A new model choice had no effect | The rule from `/setup-pstack` applies to new chats. Start one. |",
					replacement:
						"| A new seat choice had no effect | The table from `/setup-pstack` applies to new agent runs. Start a new run. |",
				},
				{
					kind: "replace",
					anchor: "| Parallel agents overwrote each other | Give each agent its own worktree, or run them as cloud agents, which each get their own machine. |",
					replacement:
						"| Parallel agents overwrote each other | Give each agent its own worktree and start it with `--cwd` pointed there. |",
				},
				{
					kind: "replace",
					anchor: "| An overnight run moved but finished nothing | `/loop` needs a check that can pass or fail, not a duration. See [guide page 7](../../docs/guide/07-overnight.md). |",
					replacement:
						"| An overnight run moved but finished nothing | The run needs a check that can pass or fail, not a duration. See the [carried guide page 7](references/upstream/guide/07-overnight.md). |",
				},
				{
					kind: "replace",
					anchor: "[Guide page 2](../../docs/guide/02-poteto-mode.md) has examples.",
					replacement:
						"[Guide page 2](references/upstream/guide/02-poteto-mode.md) has examples.",
				},
				{
					kind: "replace",
					anchor: "[Guide page 6](../../docs/guide/06-verify-and-ship.md) covers opening, babysitting, and landing a PR.",
					replacement:
						"[Guide page 6](references/upstream/guide/06-verify-and-ship.md) covers opening, babysitting, and landing a PR.",
				},
				{
					kind: "replace",
					anchor: "[Guide page 8](../../docs/guide/08-principles.md) lists them.",
					replacement:
						"[Guide page 8](references/upstream/guide/08-principles.md) lists them.",
				},
				{
					kind: "replace",
					anchor: "For a run that drifts, [`references/prompting.md`](references/prompting.md) has one-line steers. [Guide page 10](../../docs/guide/10-recipes-and-pitfalls.md) has more pitfalls and the recipes worth copying.",
					replacement:
						"For a run that drifts, [`references/prompting.md`](references/prompting.md) has one-line steers. [Guide page 10](references/upstream/guide/10-recipes-and-pitfalls.md) has more pitfalls and the recipes worth copying.",
				},
				{
					kind: "replace",
					anchor: "[Guide page 9](../../docs/guide/09-make-it-yours.md) covers each of these.",
					replacement:
						"[Guide page 9](references/upstream/guide/09-make-it-yours.md) covers each of these.",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/prompting.md",
			intent: "Replace the Cursor /loop handoff with the Autonomous run predicate, so an away prompt names a runtime the project actually has.",
			ops: [
				{
					kind: "replace",
					anchor: "- Write done as checks every iteration can run, and give `/loop` that predicate.",
					replacement:
						"- Write done as checks every iteration can run, and give the Autonomous run playbook that predicate.",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/recipes.md",
			intent: "Adapt the away prompt recipe from Cursor /loop to the Botlake autonomous run, keeping the same done checks and escape hatch.",
			ops: [
				{
					kind: "replace",
					anchor: "keep a decision log. don't ask me before committing. /loop until done. if you're truly stuck after a few hours, stop and write up why.`",
					replacement:
						"keep a decision log. don't ask me before committing. run until done. if you're truly stuck after a few hours, stop and write up why.`",
				},
			],
		},
		{
			skill: "poteto-mode",
			target: "./scripts/worktree-audit.sh",
			intent: "Delete the runtime-only worktree auditor. Its delete-safety column depends on Cursor's global chat transcript store, which does not exist under Botlake; the cleanup playbook now bases in-use checks on lake agent records and live worktrees instead of a script that would silently report stale chat evidence.",
			delete: true,
		},
	];
}
