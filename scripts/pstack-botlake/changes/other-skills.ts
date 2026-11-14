import { readTemplate } from "../apply.ts";
import type { FileEdit } from "../model.ts";

/** Remaining independently invoked skills: setup support, comment review, verification, decision trail. */
export function otherSkillChanges(): FileEdit[] {
	return [
		{
			skill: "swarm",
			target: "./SKILL.md",
			intent: "Fan workers out as lake runs in isolated worktrees on the role seat, replacing Task fields, cloud environments, and cloud base branches.",
			ops: [
				{
					kind: "replace",
					anchor: "3. Pick the worker model from the `swarm workers` line in `~/.cursor/rules/pstack-models.mdc`. If the rule or that line is missing, use `grok-4.7-xhigh-fast`. For `auto` or `inherit-parent`, omit `model` so the workers run on the parent model. If the Task tool rejects a slug, use the default and say so. If it rejects the default, use the closest valid slug of the same family from its error message. For a model race, name each arm's model up front. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.",
					replacement:
						"3. Pick the worker seat from the `swarm workers` line in `.botlake/pstack-roles.md`. If the table or that line is missing, inspect `bl agent catalog` and select an available seat whose purpose fits the worker task. Validate configured seats against the catalog too. If a seat is refused, read the error and use `bl agent catalog`; do not guess a model slug. For a seat race, name each arm's seat up front. Choose each run's effort per poteto-mode's Delegates section. Start and observe runs per [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: 'Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the step 3 model, left unset for `auto` or `inherit-parent`. Use `environment: "local"` only when the worker needs access to something on the user\'s computer.',
					replacement:
						"Start all N worker runs with `bl agent start`, each on the step 3 seat and in its own worktree (`wktree add --branch <branch>`, then `--cwd` at `wktree path --branch <branch>`). Workers use this machine, but verify that the chosen harness actually has the required auth, simulator, or browser access; shared hosting does not grant those capabilities automatically.",
				},
				{
					kind: "replace",
					anchor: "When a worker must start from a non-default pushed branch, pass `cloud_base_branch`.",
					replacement:
						"When a worker must start from a non-default pushed branch, create its worktree from that branch with `wktree add --branch <branch> --base <pushed-branch>`.",
				},
			],
		},
		{
			skill: "automate-me",
			target: "./SKILL.md",
			intent: "Mine lake run records instead of Cursor transcript directories, use the project's actual authoring guidance, and place mode skills in a real source directory rather than the generated install.",
			ops: [
				{
					kind: "replace",
					anchor: 'description: "Use for \\"automate me\\", \\"create/update/refresh my -mode skill\\", \\"turn/capture my preferences or working style into a skill\\", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill via create-skill + unslop, optionally pulling fresh evidence from recent transcripts."',
					replacement:
						'description: "Use for \\"automate me\\", \\"create/update/refresh my -mode skill\\", \\"turn/capture my preferences or working style into a skill\\", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill via the project\'s skill-authoring guidance + unslop, optionally pulling fresh evidence from recent lake run records."',
				},
				{
					kind: "replace",
					anchor: "This skill orchestrates three others: an inline mining pass (see step 1), Cursor's built-in `create-skill` (authoring), and the **unslop** skill (prose discipline).",
					replacement:
						"This skill orchestrates three others: an inline mining pass (see step 1), the project's skill-authoring guidance (`skillbox-author` when installed, otherwise the Agent Skills format), and the **unslop** skill (prose discipline).",
				},
				{
					kind: "replace",
					anchor: 'Look recursively for `.cursor/skills/**/*-mode/SKILL.md` and `~/.cursor/skills/*-mode/SKILL.md` matching the user\'s handle. Mode skills can live in a personal category directory (`.cursor/skills/<handle>/`), not only at the top level. If one exists, confirm intent with `AskQuestion` (unless they already said "update my skill" or similar):',
					replacement:
						"Look for the user's existing mode skill in the project's skill sources: `.agents/skills/*-mode/SKILL.md` for the installed copy, the prepared Skillbox bundle workspace, or the project's own skill source directory. Mode skills can live in a personal category directory, not only at the top level. Locate the source, not just the generated copy. If one exists, confirm intent with a short question in chat (unless they already said \"update my skill\" or similar):",
				},
				{
					kind: "replace",
					anchor: "Locate the active workspace's transcripts before fanning out. The system prompt names the workspace's `agent-transcripts/` directory. Use only that path. Don't glob across `~/.cursor/projects/*/`. That crosses workspace boundaries and reads private chats from unrelated projects.",
					replacement:
						"Collect this run's history from the lake before fanning out: `bl agent list`, `bl agent show RUN_ID`, `bl agent activity peek RUN_ID`, and `bl work show <id> --history`. Use only records for this workspace or this run. Do not read another project's history. A native transcript is available only through the pointer this harness names. The mapping is in [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "Survey recent agent conversations within that scope for recurring patterns. Run multiple parallel subagents across slices of history (e.g. last 2-4 weeks, split into 3 slices so each has enough material). Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill. Each slice mining subagent reads transcripts from the workspace-scoped path the parent provides,",
					replacement:
						"Survey recent agent records within that scope for recurring patterns. Start multiple parallel runs across slices of history (e.g. last 2-4 weeks, split into 3 slices so each has enough material). Choose each run's seat and effort per poteto-mode's Delegates section. Each slice run reads the records the parent provides,",
				},
				{
					kind: "replace",
					anchor: "- Delegation habits (subagents, models, specialized workflows, parallelism)",
					replacement:
						"- Delegation habits (agent runs, seats, specialized workflows, parallelism)",
				},
				{
					kind: "replace",
					anchor: "- **Subagents**: default, parallelism, model-to-task, specialized workflows.",
					replacement:
						"- **Agent runs**: default, parallelism, seat-to-task, specialized workflows.",
				},
				{
					kind: "replace",
					anchor: "Mining misses intent that hasn't come up yet. Use the `AskQuestion` tool (structured multi-choice) rather than asking the user to type from scratch.",
					replacement:
						"Mining misses intent that hasn't come up yet. Ask a short structured multiple-choice question in chat rather than asking the user to type from scratch.",
				},
				{
					kind: "replace",
					anchor: "Use Cursor's built-in `create-skill` skill to author the skill. Placement:",
					replacement:
						"Use the project's skill-authoring guidance to author the skill. Placement:",
				},
				{
					kind: "replace",
					anchor: "- Path: preserve an existing mode skill's category. For a new mode, use `.cursor/skills/<handle>/<handle>-mode/SKILL.md` when the repo has an established personal category for that handle. Otherwise default to `.cursor/skills/<handle>-mode/SKILL.md` in the project (or `~/.cursor/skills/<handle>-mode/` if the user prefers a personal skill).",
					replacement:
						"- Path: preserve an existing mode skill's source location and category. For a new mode, use the project's skill source directory, never the generated `.agents/skills/` output; when the project has an established personal category for that handle, keep it. Otherwise use a new `<handle>-mode` skill in the project's source skills directory.",
				},
				{
					kind: "replace",
					anchor: "- Frontmatter formatting: follow `create-skill`'s YAML rules.",
					replacement:
						"- Frontmatter formatting: follow the skill-authoring guidance's YAML rules.",
				},
				{
					kind: "replace",
					anchor: "Apply the **unslop** skill and `create-skill`'s writing guidelines to every line.",
					replacement:
						"Apply the **unslop** skill and the skill-authoring guidance's writing rules to every line.",
				},
				{
					kind: "replace",
					anchor: "A `-mode` skill is subjective output. A `create-skill`-style test/iterate benchmark loop isn't useful here.",
					replacement:
						"A `-mode` skill is subjective output. A skill-authoring test/iterate benchmark loop isn't useful here.",
				},
				{
					kind: "replace",
					anchor: "- User wants a task-specific skill (not working conventions): `create-skill` alone, no mining required.",
					replacement:
						"- User wants a task-specific skill (not working conventions): the skill-authoring guidance alone, no mining required.",
				},
			],
		},
		{
			skill: "no-comments",
			target: "./references/comment-sicko.md",
			intent: "Carry Comment Sicko's brief in the skill. The plugin agent is never installed, so a Botlake reviewer run needs the text and the read-only scope as its prompt.",
			copyFrom: "agents/comment-sicko.md",
			ops: [
				{
					kind: "replace",
					anchor: "---\nname: comment-sicko\ndescription: A deranged comment-hater that savors deletion and condemns workaround code.\n---\n\n# Comment Sicko\n",
					replacement:
						"# Comment Sicko brief\n\nPass this file plus the scope as the prompt of a fresh, read-only Botlake agent run. It is a reviewer brief, not an installed agent.\n\n## Comment Sicko\n",
				},
			],
		},
		{
			skill: "no-comments",
			target: "./SKILL.md",
			intent: "Start Comment Sicko as a lake reviewer run with the carried brief instead of an uninstalled Cursor agent type.",
			ops: [
				{
					kind: "replace",
					anchor: '1. Spawn `Task` with `subagent_type: "comment-sicko"`. Pass the scope. Pick each subagent\'s reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill. Do not restate its rules.',
					replacement:
						"1. Read [`references/comment-sicko.md`](references/comment-sicko.md) and include its text plus the review scope in a complete prompt. Select an available review seat from `bl agent catalog`, honoring the role table when configured. Start a read-only run with `bl agent start --seat <review-seat> --cwd <absolute-project-root> --prompt '<complete-brief-and-scope>'`. Choose effort from the seat's supported settings. Do not restate the review rules. Mechanics are in [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
			],
		},
		{
			skill: "show-me-your-work",
			target: "./SKILL.md",
			intent: "Audit the trail against lake run records and the harness's own transcript pointer, and run the cross-model review as an agent run on another seat.",
			ops: [
				{
					kind: "replace",
					anchor: "At the end of the run, before handing back, check the log told the truth. Read this run's transcript under the active workspace's `agent-transcripts/` directory (the system prompt names the path). Don't glob across `~/.cursor/projects/*/`. That reads unrelated private chats.",
					replacement:
						"At the end of the run, before handing back, check the log told the truth. Read this run's record through `bl agent show RUN_ID` and `bl agent activity peek RUN_ID`, plus the native transcript pointer this harness names for the session when available. A bounded activity snapshot is not a full conversation audit; state which evidence the review actually covered. Don't glob a global transcript directory; that reads unrelated private chats.",
				},
				{
					kind: "replace",
					anchor: "Before handing back, spawn a subagent on a different model family from the one that did the work. Self-review is not a substitute. The subagent reads the audit trail and the run's transcript, then flags what the user should pay attention to. Not a redo of the work, a scan for what's suboptimal or risky. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.",
					replacement:
						"Before handing back, inspect `bl agent catalog` and start an available review seat whose configured model differs from the one that did the work, when one is available. Provider names alone do not establish model diversity; report any limitation. Self-review is not a substitute. The run reads the audit trail and the run record, then flags what the user should pay attention to. Not a redo of the work, a scan for what's suboptimal or risky. Choose the run's seat and effort per poteto-mode's Delegates section; mechanics are in [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "Lead with the reviewer's model on its own line (`reviewed by <model>`),",
					replacement:
						"Lead with the reviewer's seat on its own line (`reviewed by <seat>`),",
				},
				{
					kind: "replace",
					anchor: '"No flags" is a valid value. The model name is not.',
					replacement: '"No flags" is a valid value. The seat name is not.',
				},
			],
		},
		{
			skill: "create-verification-skill",
			target: "./SKILL.md",
			intent: "Generate the verification skill into a real project skill source directory instead of Cursor's .cursor/skills install path.",
			ops: [
				{
					kind: "replace",
					anchor: "This skill generates that as a project-local skill (`.cursor/skills/verify-<app>/`) tailored to the repo.",
					replacement:
						"This skill generates that as a project-local `verify-<app>` skill tailored to the repo, written to the project's skill source directory rather than the generated `.agents/skills/` output. When the proof needs a lake run or a bounded wait, the run mechanics are in [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "Write `.cursor/skills/verify-<app>/SKILL.md` with YAML frontmatter",
					replacement:
						"Write `SKILL.md` inside the project's source directory for `verify-<app>`, with YAML frontmatter",
				},
				{
					kind: "replace",
					anchor: "Create `.cursor/skills/verify-<app>/features/README.md` plus one file per user-facing feature",
					replacement:
						"Create the same skill's `features/README.md` plus one file per user-facing feature",
				},
			],
		},
		{
			skill: "maintain-verification-skill",
			target: "./SKILL.md",
			intent: "Locate the verification skill through the project's source or installed skills tree, and read feature files with lake agent runs.",
			ops: [
				{
					kind: "replace",
					anchor: "the project-local skill whose body has launch/drive sections and a feature map (usually `.cursor/skills/verify-*/`).",
					replacement:
						"the project-local skill whose body has launch/drive sections and a feature map, in the project's skill source or its installed copy under `.agents/skills/verify-*/`. Use an installed copy to locate its configured source; edit that source, never the generated installation.",
				},
				{
					kind: "replace",
					anchor: "2. **Source wave.** One read-only subagent per feature file, launched concurrently.",
					replacement:
						"2. **Source wave.** One read-only agent run per feature file, launched concurrently (mechanics in [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md)).",
				},
				{
					kind: "replace",
					anchor: "Children never drive the app and never edit files.",
					replacement: "Runs never drive the app and never edit files.",
				},
			],
		},
		{
			skill: "make-bot-ui",
			target: "./SKILL.md",
			intent: "Replace the external Cursor webhook workflow with a real Botlake UI workflow: discover the configured UI, use task/agent views for status, build a narrow local action page over registered lake commands with validated inputs, and prove one harmless action against lake state. This keeps the skill identity and removes runnable obsolete setup.",
			content: readTemplate("make-bot-ui.md"),
			replace: true,
		},
	];
}
