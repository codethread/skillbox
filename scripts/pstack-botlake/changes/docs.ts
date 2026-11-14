import type { FileEdit } from "../model.ts";
import { readTemplate } from "../apply.ts";

/**
 * Carried upstream guide text. The copy step rewrites skill links to the flat
 * install and drops links to omitted images and adapter pages; these ops adapt
 * the runtime passages that would otherwise instruct a Cursor user.
 */
export function docsChanges(): FileEdit[] {
	return [
		{
			skill: "poteto-help",
			target: "./references/upstream/LICENSE",
			intent: "Carry the upstream MIT licence with the copied guide text so the attribution and redistribution terms travel with the docs.",
			copyFrom: "LICENSE",
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/ATTRIBUTION.md",
			intent: "Record provenance (repository, exact commit, subtree OIDs), the MIT licence, and the curation and runtime-adaptation rules applied to the carried upstream text.",
			content: readTemplate("attribution.md"),
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/README.md",
			intent: "Carry the guide index with its install and model links replaced by Skillbox and the Botlake role table, and without omitted images.",
			copyFrom: "docs/guide/README.md",
			ops: [
				{
					kind: "replace",
					anchor: "Install the plugin and pick your models.",
					replacement: "Install the bundle and pick the lake seats for each role.",
				},
				{
					kind: "replace",
					anchor: "Trust before loops, an overnight contract, a decision log you can audit, and Projects and automations that scale past one agent.",
					replacement:
						"Trust before loops, an overnight contract, a decision log you can audit, and work records plus lake scheduling that scale past one agent.",
				},
				{
					kind: "replace",
					anchor: "It answers, hands you a prompt to send, and links the skill or guide page the answer came from. It doesn't start the work, because a pstack run spends real tokens, so you send the prompt when you're ready. It runs only when you type it.",
					replacement:
						"It answers, hands you a prompt to send, and links the skill or guide page the answer came from. It doesn't start the work, because a pstack run spends real tokens, so you send the prompt when you're ready.",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/01-setup.md",
			intent: "Replace Cursor plugin installation and model-rule setup with Skillbox installation, the lake agent catalog, and the project role table; keep the guide's setup flow and verification offers.",
			copyFrom: "docs/guide/01-setup.md",
			ops: [
				{
					kind: "range",
					start: "## Install the plugin\n",
					end: "The Claude Code adapter covers the other differences.\n",
					replacement: `## Install the bundle

Install the pstack bundle with Skillbox in the project, then run \`skillbox sync\` to generate \`.agents/skills/\`. The bundle README owns the exact commands. This guide covers the Botlake surface: the lake's seats, role table, and agent runs replace Cursor plugin commands and model rules. Read [\`botlake-tools.md\`](../../../../poteto-mode/references/botlake-tools.md) before your first runtime step.
`,
				},
				{
					kind: "range",
					start: "## Pick your models\n",
					end: "Setup also configures `swarm workers`, the default model for every `/swarm` worker unless a race names a model for each arm.\n",
					replacement: `## Pick your seats

Run:

\`\`\`text
/setup-pstack
\`\`\`

[\`/setup-pstack\`](../../../../setup-pstack/SKILL.md) reads the seats from \`bl agent catalog\`, asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes \`.botlake/pstack-roles.md\`, a small role table every pstack skill reads before it starts an agent run.

The defaults run at \`high\` effort, one step below the \`large\` budget. \`unlimited\` lifts each role to its highest supported effort, up to \`max\`, where the seat supports it. \`medium\` and \`small\` lower the reasoning and spend fewer tokens.

You only override what you care about. A role with no line in the table keeps the skill's default. To restore a default, delete that role's line. A rerun of \`/setup-pstack\` keeps any role you changed. When a default changes, a table written before the change still pins the old choice, so delete those role lines, or delete the file, then run \`/setup-pstack\` again.

Botlake runs always start from a seat, so the table names one for every role; there is no parent-model alias. For a panel role the value is a list, and one run starts per entry, so the list length sets the panel size. Setup also configures \`swarm workers\`, the default seat for every \`/swarm\` worker unless a race names a seat for each arm.
`,
				},
				{
					kind: "replace",
					anchor: "Say yes and it writes `.cursor/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does.",
					replacement:
						"Say yes and it writes a project-local `verify-<app>` skill into the project's skill source directory, which teaches agents to drive your app the way a user does.",
				},
				{
					kind: "replace",
					anchor: "After setup, start a new chat. The model rule applies to new sessions.",
					replacement:
						"After setup, start a new agent run. The role table applies to new runs.",
				},
				{
					kind: "replace",
					anchor: "- Rerun `/setup-pstack` and pick a smaller reasoning budget or cheaper models. A strong model in the main chat with cheaper, faster models in the code roles is a good split.\n- Set a role to `auto` or `inherit-parent` so it runs on the chat's own model.\n- Shorten a panel list. Each entry runs one subagent.",
					replacement:
						"- Rerun `/setup-pstack` and pick a smaller reasoning budget or cheaper seats. A strong seat for judgment with cheaper, faster seats for code roles is a good split.\n- Lower a routine role's effort instead of changing its seat.\n- Shorten a panel list. Each entry starts one run.",
				},
				{
					kind: "replace",
					anchor: "From here you can type normal follow-ups. To keep `/poteto-mode` on for the whole chat, pick it from the `/` menu with Option+Enter (Mac) or Alt+Enter (Windows) instead of Enter. That makes it a [Custom Mode](https://cursor.com/docs/skills#using-a-skill-as-a-custom-mode), which stays in context on every turn until you exit it. Custom Modes are available in the Agents Window and the CLI. Plain Enter attaches the skill to one message, and it fades as the chat moves on.",
					replacement:
						"From here you can type normal follow-ups. Whether `/poteto-mode` stays in context depends on the harness: when it drops, name the skill again. Each task should start from the skill's playbook, not from the previous task's momentum. This install has no separate persistent-mode step.",
				},
				{
					kind: "replace",
					anchor: "In this page you install the plugin, pick which models pstack uses, and run your first task.",
					replacement:
						"In this page you install the bundle, pick which seats pstack uses, and run your first task.",
				},
				{
					kind: "replace",
					anchor: "pstack spends extra tokens on subagents and review panels.",
					replacement: "pstack spends extra tokens on delegated runs and review panels.",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/02-poteto-mode.md",
			intent: "Replace Custom Mode persistence and Cursor cloud subagents with harness-neutral context guidance and one worktree per lake run.",
			copyFrom: "docs/guide/02-poteto-mode.md",
			ops: [
				{
					kind: "replace",
					anchor: "Short works because the playbook holds the structure, and a Custom Mode keeps `/poteto-mode` in context on every turn.",
					replacement:
						"Short works because the playbook holds the structure. Whether the skill stays attached depends on the harness; name `/poteto-mode` again when it drops.",
				},
				{
					kind: "replace",
					anchor: "If you run several agents against one repository on one computer, they will fight over the working tree, the ports, and the build output. The cleanest isolation is a [cloud subagent](https://cursor.com/docs/subagents#cloud-subagents). Each one gets its own VM and branch, so it can install dependencies, run your app, and record video of the result without touching your machine. Type `/in-cloud` before the task, or ask the parent chat to hand work to cloud subagents.",
					replacement:
						"If you run several agents against one repository on one computer, they will fight over the working tree, the ports, and the build output. Give each run its own worktree: create one with `wktree add --branch <branch>` (run `wktree -h` first), then start the run with `--cwd` at `wktree path --branch <branch>`. The run can install dependencies, launch the app, and record video in its own checkout without touching yours. See [`botlake-tools.md`](../../../../poteto-mode/references/botlake-tools.md) for the run commands.",
				},
				{
					kind: "replace",
					anchor: "When the work has to stay local, ask for a worktree up front:",
					replacement: "Ask for a worktree up front:",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/03-understand.md",
			intent: "Say evidence tools rather than MCPs, matching the adapted why skill's discovery rule.",
			copyFrom: "docs/guide/03-understand.md",
			ops: [
				{
					kind: "replace",
					anchor: "then queries whatever evidence categories your MCPs expose, such as the issue tracker",
					replacement:
						"then queries whatever evidence categories your tools expose, such as the issue tracker",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/04-design.md",
			intent: "Carry the design guide so the guide index and the understand page keep a working link, and describe parallel design attempts as lake runs.",
			copyFrom: "docs/guide/04-design.md",
			ops: [
				{
					kind: "replace",
					anchor: "N subagents attempt the same design or code brief in parallel, each writing to its own worktree or directory.",
					replacement:
						"N agent runs attempt the same design or code brief in parallel, each writing to its own worktree or directory.",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/05-build-and-clean.md",
			intent: "Replace the uninstalled Cursor deslop skill and agent link with the inline slop-strip rule and the carried Comment Sicko brief.",
			copyFrom: "docs/guide/05-build-and-clean.md",
			ops: [
				{
					kind: "replace",
					anchor: "runs `/deslop` on the diff before each commit and applies",
					replacement:
						"strips slop per poteto-mode's Comments rule before each commit and applies",
				},
				{
					kind: "replace",
					anchor: "`/deslop` ships in the `cursor-team-kit` plugin, not in pstack. If you don't have it, ask for the same outcome in plain words:",
					replacement:
						"This install has no separate slop skill, so ask for the same outcome in plain words:",
				},
				{
					kind: "replace",
					anchor: "a read-only reviewer with a short keep list:",
					replacement: "a read-only reviewer run with a short keep list:",
				},
				{
					kind: "replace",
					anchor: "The division of labor is worth keeping straight. `/deslop` cleans slop out of the code, `/unslop` cleans it out of prose, and `/no-comments` hands the comments to a reviewer who didn't write them.",
					replacement:
						"The division of labor is worth keeping straight. The Comments rule cleans slop out of the code, `/unslop` cleans it out of prose, and `/no-comments` hands the comments to a reviewer that didn't write them.",
				},
				{
					kind: "replace",
					anchor: "If the diff feels padded, say `deslop it` before you commit, not after review calls it out.",
					replacement:
						'If the diff feels padded, say "strip the slop" before you commit, not after review calls it out.',
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/06-verify-and-ship.md",
			intent: "Write the verification skill into a project skill source directory instead of Cursor's .cursor/skills install path.",
			copyFrom: "docs/guide/06-verify-and-ship.md",
			ops: [
				{
					kind: "replace",
					anchor: "It writes `.cursor/skills/verify-<app>/`, agent-facing instructions with exact Launch, Doctor, Drive, Evidence, and Cleanup sections",
					replacement:
						"It writes a project-local `verify-<app>` skill into the project's skill source directory, with exact Launch, Doctor, Drive, Evidence, and Cleanup sections",
				},
				{
					kind: "replace",
					anchor: "Run this at least once a day, ideally from a scheduled automation so nobody has to remember:",
					replacement:
						"Run this at least once a day, ideally from a scheduled run when the lake or harness provides one, so nobody has to remember:",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/07-overnight.md",
			intent: "Replace Cursor /loop, cloud agents, restarts, and the dormant Cursor automation pack with bounded lake waits, worktrees, harness-neutral restarts, and honest scheduling discovery.",
			copyFrom: "docs/guide/07-overnight.md",
			ops: [
				{
					kind: "replace",
					anchor: "It's a checkable finish condition, an isolated worktree or cloud agent, and a decision log you audit in the morning.",
					replacement:
						"It's a checkable finish condition, an isolated worktree, and a decision log you audit in the morning.",
				},
				{
					kind: "replace",
					anchor: "/loop until done. if you're truly stuck after a few hours, stop and write up why.",
					replacement:
						"run until done. if you're truly stuck after a few hours, stop and write up why.",
				},
				{
					kind: "replace",
					anchor: "- `/loop` is Cursor's built-in wake mechanism, not a pstack skill.",
					replacement:
						"- Discover scheduling through the configured lake or harness; bounded `bl await` only observes a condition.",
				},
				{
					kind: "replace",
					anchor: "uses it to re-check the finish condition on events or a heartbeat.",
					replacement:
						"uses bounded lake waits and a re-arm step to re-check the finish condition on events or a heartbeat.",
				},
				{
					kind: "replace",
					anchor: "To stop a run on purpose, tell the agent to pause, or that you're about to go offline or restart Cursor.",
					replacement:
						"To stop a run on purpose, tell the agent to pause, or that you're about to go offline or restart the harness.",
				},
				{
					kind: "range",
					start: "Every loop above still waits for you to start it.",
					end: "Point an agent at its `FOR_AGENTS.md` and name the target repository to set it up.\n",
					replacement: `Every loop above still waits for you to start it. A scheduled or event-driven trigger removes that step when the harness or the lake provides one. Discover what the lake actually schedules with \`bl help\`, \`bl prime <op>\`, and \`botlake bin list\`; do not assume a scheduler exists.

Two rules keep such a line trustworthy:

- Every stage can stop the line. Triage can decide the report is expected behavior, repro can fail to reproduce it, and the fixer can judge the change too risky. Each of those outcomes is useful, because it keeps bad work from reaching the next stage, where it costs more to undo.
- Every stage hands over evidence. Repro attaches screenshots and video of the broken state, and the fix attaches before-and-after proof. A human can then check that the agent fixed the right thing before reading a line of code.

The software-maintenance pipeline fits when the lake can schedule it: triage a report, reproduce it, fix it, verify the fix. Without a scheduler, the same pipeline runs as a bounded re-arm from a coordinator, never as an unbounded poll.
`,
				},
				{
					kind: "replace",
					anchor: "Give `/loop` a predicate that can pass or fail.",
					replacement: "Give the run a predicate that can pass or fail.",
				},
				{
					kind: "replace",
					anchor: "- You've read a few transcripts and turned the repeated failures into tools, skills, or checks.",
					replacement:
						"- You've read a few run records and turned the repeated failures into tools, skills, or checks.",
				},
				{
					kind: "replace",
					anchor: "Before the skill hands back its summary, it spawns a reviewer on a different model family to read the trail and the transcript,",
					replacement:
						"Before the skill hands back its summary, it starts a reviewer run on a different seat family to read the trail and the run record,",
				},
				{
					kind: "replace",
					anchor: "multi-day, many stacked PRs, fleets of subagents under one standing coordinator chat.",
					replacement:
						"multi-day, many stacked PRs, fleets of agent runs under one standing coordinator.",
				},
				{
					kind: "range",
					start: "A [Cursor Project](https://cursor.com/blog/projects) gives one coordinator agent a persistent thread.",
					end: "- Ask the coordinator for a plan backed by data, and have it answer open questions with prototypes before it asks you.\n",
					replacement: `A lake work group gives one coordinator a durable record instead of a chat thread. The coordinator starts agent runs in their own worktrees and tracks them through work tasks, criteria, and notes. The records survive sessions; execution still needs an awake host and an available harness. Record a resume point before the host stops. That's the shape the Orchestrate playbook expects. Start the coordinator with \`/poteto-mode\`, and the runs it starts follow the playbooks.

A few habits help:

- Give each body of work its own group, such as a feature, a migration, a perf push, or a tech-debt cleanup. Several can run side by side.
- Link related tasks and runs into the group, finished ones included. Their notes become context for every run in it.
- Give each PR a verification swarm before it merges, and let Autopilot-stack or Autopilot-full carry the queue.
- Ask the coordinator for a plan backed by data, and have it answer open questions with prototypes before it asks you.
`,
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/08-principles.md",
			intent: "Carry the principles guide, replacing one delegation sentence that says subagents where Botlake starts agent runs.",
			copyFrom: "docs/guide/08-principles.md",
			ops: [
				{
					kind: "replace",
					anchor: "routes bulk reading to subagents and keeps findings in the main chat.",
					replacement:
						"routes bulk reading to agent runs and keeps findings in the main chat.",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/09-make-it-yours.md",
			intent: "Replace Cursor transcript mining, .cursor skill paths, and the create-skill built-in with lake run records, project skill sources, and the project's authoring guidance.",
			copyFrom: "docs/guide/09-make-it-yours.md",
			ops: [
				{
					kind: "replace",
					anchor: "It mines your recent transcripts in the active workspace for repeated preferences",
					replacement:
						"It mines your recent lake run and work records for repeated preferences",
				},
				{
					kind: "replace",
					anchor: "It drafts `.cursor/skills/<your-name>-mode/SKILL.md` through Cursor's built-in `create-skill` flow",
					replacement:
						"It drafts a `<your-name>-mode` skill in the project's skill source directory through the project's skill-authoring guidance (`skillbox-author` when installed)",
				},
				{
					kind: "replace",
					anchor: "which routes through Cursor's built-in `create-skill`, validates the frontmatter and links",
					replacement:
						"which routes through the project's skill-authoring guidance, validates the frontmatter and links",
				},
				{
					kind: "replace",
					anchor: "The playbooks, routing, and model roles underneath it work just as well with yours.",
					replacement:
						"The playbooks, routing, and seat roles underneath it work just as well with yours.",
				},
				{
					kind: "replace",
					anchor: "sends the transcript to three parallel reviewers",
					replacement: "sends the run record to three parallel reviewer runs",
				},
			],
		},
		{
			skill: "poteto-help",
			target: "./references/upstream/guide/10-recipes-and-pitfalls.md",
			intent: "Replace Cursor /loop and cloud-agent pitfalls with bounded-run and worktree guidance, and omit the decorative image.",
			copyFrom: "docs/guide/10-recipes-and-pitfalls.md",
			ops: [
				{
					kind: "replace",
					anchor: '- **A vague finish condition.** "make it better" gives `/loop` nothing to check. Give a command or artifact that can pass or fail.',
					replacement:
						'- **A vague finish condition.** "make it better" gives the run nothing to check. Give a command or artifact that can pass or fail.',
				},
				{
					kind: "replace",
					anchor: '- **Parallel agents in one worktree.** They overwrite each other, and nobody can tell which agent changed what. Run them as cloud agents, or say "own worktree per attempt".',
					replacement:
						"- **Parallel agents in one worktree.** They overwrite each other, and nobody can tell which agent changed what. Give each run its own worktree with `wktree add --branch <branch>`, and pass its path as `--cwd`.",
				},
				{
					kind: "replace",
					anchor: "One attempt locks in the first shape the model thought of.",
					replacement: "One attempt locks in the first shape that came to mind.",
				},
				{
					kind: "replace",
					anchor: '- **Treating `auto` as a model slug.** `auto` and `inherit-parent` mean "omit the model field so the subagent inherits the parent chat model."',
					replacement:
						"- **Picking a seat from memory.** Seats come from `bl agent catalog`, and each role reads its seat and effort from `.botlake/pstack-roles.md`.",
				},
			],
		},
	];
}
