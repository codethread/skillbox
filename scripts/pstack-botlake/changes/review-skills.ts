import type { FileEdit } from "../model.ts";

/** Investigation, review, and recovery skills plus their carried references. */
export function reviewSkillChanges(): FileEdit[] {
	return [
		{
			skill: "how",
			target: "./SKILL.md",
			intent: "Replace Task fields and model slugs with no-write lake runs whose complete briefs use catalog-validated configured roles or live purpose-based catalog choices.",
			ops: [
				{
					kind: "replace",
					anchor: "Every spawn is a Task subagent with `subagent_type: generalPurpose` and `readonly: true`. Explorers use the `how explorer` line in the `pstack-models.mdc` rule (default `grok-4.7-xhigh-fast`), and every explainer uses the `how explainer` line (default `claude-opus-5-5-xhigh`). Set `model` to that line's value, or to the default if the rule or the line is missing. Leave `model` unset when the value is `auto` or `inherit-parent`. If the Task tool rejects a slug, use the default and say so. If it rejects the default, use the closest valid slug of the same family from its error message. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.",
					replacement:
						"Every run's brief explicitly forbids edits. Explorers use the `how explorer` role in `.botlake/pstack-roles.md`, and explainers use `how explainer`. Before using a configured seat or effort, verify it against `bl agent catalog`; if the role is missing or invalid, choose a listed seat by purpose (fast codebase exploration for explorers, strong synthesis and prose for explainers) and omit `--effort`. Fill the appropriate reference template completely, pass that filled text as the run's prompt, start it in the current checkout, and keep its id. Do not guess a seat or model slug. Start and observe runs per [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: '**Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Spawn one explainer that explores and explains in one pass',
					replacement:
						'**Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Start one explainer run that explores and explains in one pass',
				},
				{
					kind: "replace",
					anchor: "Spawn all explorers in a single message, each with `references/explorer-prompt.md` and its angle filled in.",
					replacement:
						"Start all explorer runs together, each with `references/explorer-prompt.md` and its angle filled in.",
				},
				{
					kind: "replace",
					anchor: "Once all explorers have returned, spawn one explainer with `references/explainer-prompt.md` and every explorer's findings filled in.",
					replacement:
						"Once all explorer runs have returned, start one explainer run with `references/explainer-prompt.md` and every explorer's findings filled in.",
				},
			],
		},
		{
			skill: "how",
			target: "./references/explorer-prompt.md",
			intent: "Describe the template as a brief for an agent run, not a subagent prompt, so the carried prompt files match the adapted how skill.",
			ops: [
				{
					kind: "replace",
					anchor: "Build each explorer subagent's prompt from this template. Fill in the placeholders.",
					replacement:
						"Build each explorer run's brief from this template. Fill in the placeholders.",
				},
			],
		},
		{
			skill: "how",
			target: "./references/explainer-prompt.md",
			intent: "Make the explainer template a portable no-write agent brief without assuming Cursor's built-in file tools.",
			ops: [
				{
					kind: "replace",
					anchor: "Build the explainer subagent's prompt from this template. Fill in the placeholders.",
					replacement:
						"Build the explainer run's brief from this template. Fill in the placeholders.",
				},
				{
					kind: "replace",
					anchor: "You have read-only access to the codebase to check anything, clarify a detail, or fill a gap. Use Read, Grep, and Glob as needed. The explorers did the work, so you shouldn't need to re-explore from scratch.",
					replacement:
						"Do not modify the codebase. Use the file-reading and search tools this harness exposes to check details or fill a gap. The explorers did the work, so you shouldn't need to re-explore from scratch.",
				},
			],
		},
		{
			skill: "why",
			target: "./SKILL.md",
			intent: "Discover the evidence access the session actually exposes, condition GitHub use on availability, and route no-write investigators through catalog-validated configured roles or live purpose-based choices.",
			ops: [
				{
					kind: "replace",
					anchor: "description: \"Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers available MCPs and queries each evidence category (source control, issue tracker, long-form docs, real-time chat, infrastructure observability, error tracking, product analytics warehouse) in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior.\"",
					replacement:
						"description: \"Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers the evidence tools this session exposes and queries each evidence category (source control, issue tracker, long-form docs, real-time chat, infrastructure observability, error tracking, product analytics warehouse) in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior.\"",
				},
				{
					kind: "replace",
					anchor: "Each spawn below names a role line in the `pstack-models.mdc` rule and a default. Set `model` to that line's value, or to the default if the rule or the line is missing. Leave `model` unset when the value is `auto` or `inherit-parent`. If the Task tool rejects a slug, use the default and say so. If it rejects the default, use the closest valid slug of the same family from its error message. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.",
					replacement:
						"Each run below names a role in `.botlake/pstack-roles.md`. Before using a configured seat or effort, verify it against `bl agent catalog`. If the role is missing or invalid, choose a listed seat by purpose (fast evidence search for investigators, strong judgment and cited prose for the synthesizer) and omit `--effort`. Do not guess a seat or model slug. Start and observe runs per [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "Every spawn is `generalPurpose` with `readonly: false` (agent mode). **Do not use readonly/Ask mode.** It strips MCP access, which disables the MCP-backed investigators and the synthesizer's citation spot-checks. Investigators still shouldn't write anything.",
					replacement:
						"Every investigator and synthesizer brief explicitly forbids file edits and external mutations. Evidence access comes from the tools exposed to that run, so discover those tools first and report unavailable sources instead of assuming a permission mode.",
				},
				{
					kind: "replace",
					anchor: "Before spawning investigators, list the available MCPs from the Cursor environment. Use the available-tools map when present. Otherwise inspect the `mcps/` directory Cursor exposes for enabled MCP servers.",
					replacement:
						"Before spawning investigators, inventory the evidence access this session actually exposes: the harness tool list and advertised skills, lake programs from `botlake bin list`, and any MCP servers the harness lists. Inspect each tool's help or schema before naming operations. Do not assume a source tool exists.",
				},
				{
					kind: "replace",
					anchor: "Map each available MCP to one evidence category:",
					replacement: "Map each available evidence tool to one evidence category:",
				},
				{
					kind: "replace",
					anchor: "Source control is always available through git and `gh`. For the other six, classify using the MCP name, server instructions, tool names, and resource descriptors. If an MCP could fit more than one category, choose the one matching its primary evidence. Record ambiguous cases in the coverage map.",
					replacement:
						"When the target is in a Git checkout, source control is available through `git`; use `gh` only when the forge is GitHub and the command is installed and authenticated. For the other six, classify using the tool or server name, its instructions, and its operations. If a tool could fit more than one category, choose the one matching its primary evidence. Record ambiguous cases in the coverage map.",
				},
				{
					kind: "replace",
					anchor: "Before spawning investigators, build the seed context inline: file paths and line ranges, key symbols (functions, classes, constants), the last few commits touching the target, PR numbers from merge commits (pattern `(#1234)` in the subject line), and any linked ticket IDs. Run `git blame -L <start>,<end> <file>` for last-touch commits, `git log --follow -p -- <file>` for full history with patches through renames, `git log --oneline -20 -- <file>` for recent commits with PR numbers visible, and `git log -1 --format=%B <commit>` to extract PR numbers. Then pull the PR bodies and discussion for any substantive commit: `gh pr view <number> --json title,body,author,createdAt,mergedAt,labels,closingIssuesReferences,comments,reviews`. This anchor goes to every investigator and to the synthesizer.",
					replacement:
						"Before spawning investigators, build the seed context inline: file paths and line ranges, key symbols (functions, classes, constants), the last few commits touching the target, PR numbers from merge commits (pattern `(#1234)` in the subject line), and any linked ticket IDs. In a Git checkout, run `git blame -L <start>,<end> <file>` for last-touch commits, `git log --follow -p -- <file>` for full history through renames, `git log --oneline -20 -- <file>` for recent commits, and `git log -1 --format=%B <commit>` for the full message. When the forge is GitHub and authenticated `gh` access exists, pull substantive PR bodies and discussion with `gh pr view <number> --json title,body,author,createdAt,mergedAt,labels,closingIssuesReferences,comments,reviews`; otherwise record the PR-discussion gap. This anchor goes to every investigator and to the synthesizer.",
				},
				{
					kind: "replace",
					anchor: "Spawn one investigator per category that has a matching MCP, all in a single message so they run concurrently, each owning exactly one tool or MCP. Don't ask one agent to cover multiple MCPs. `model`: the `why investigators` line, default `grok-4.7-xhigh-fast`.",
					replacement:
						"Start one investigator run per available evidence category, all together so they run concurrently. Give that run the tools needed for its one category, such as both `git` and authenticated `gh` for GitHub source history; do not ask one run to cover multiple categories. Role: `why investigators`.",
				},
				{
					kind: "replace",
					anchor: "the category playbook `references/sources/<source>.md` for the selected MCP, adapted from the examples in `references/source-playbook.md`",
					replacement:
						"the category playbook `references/sources/<source>.md` for the selected tool, adapted from the examples in `references/source-playbook.md`",
				},
				{
					kind: "replace",
					anchor: '- **No MCP is available for that category** in this environment. Flag it as a gap, not a choice: "Real-time team chat skipped. No matching MCP available, so the conversational record was not searchable."',
					replacement:
						'- **No evidence tool is available for that category** in this environment. Flag it as a gap, not a choice: "Real-time team chat skipped. No matching tool available, so the conversational record was not searchable."',
				},
				{
					kind: "replace",
					anchor: "Spawn one synthesizer. `model`: the `why synthesizer` line, default `claude-opus-5-5-xhigh`.",
					replacement: "Start one synthesizer run. Role: `why synthesizer`.",
				},
				{
					kind: "replace",
					anchor: "1. **Source control** (git history, `gh` for PRs, code comments, tests). Always spawn, the only guaranteed source. Best at *implementation-time rationale captured during review*.",
					replacement:
						"1. **Source control** (Git history, plus forge access when exposed, code comments, tests). Always investigate it when the target is in a repository; otherwise record the gap. Best at *implementation-time rationale captured during review*.",
				},
			],
		},
		{
			skill: "why",
			target: "./references/source-playbook.md",
			intent: "Describe the source playbooks as examples for whatever evidence tool the session has, not as a fixed MCP catalogue.",
			ops: [
				{
					kind: "replace",
					anchor: "The playbooks are concrete examples for common MCPs. Adapt them for a different MCP in the same category.",
					replacement:
						"The playbooks are concrete examples for common evidence tools. Adapt them for a different tool in the same category, and record a gap when the session exposes none.",
				},
				{
					kind: "replace",
					anchor: "| Category | Playbook | Example MCP it documents |",
					replacement: "| Category | Playbook | Example tool it documents |",
				},
			],
		},
		{
			skill: "why",
			target: "./references/sources/code-archaeology.md",
			intent: "Condition GitHub PR access on the actual forge and authenticated gh availability while retaining the Git archaeology commands.",
			ops: [
				{
					kind: "replace",
					anchor: "- PR descriptions, review comments, and discussion threads (via `gh`)",
					replacement:
						"- PR descriptions, review comments, and discussion threads (through the forge tool this session exposes; use authenticated `gh` for GitHub)",
				},
			],
		},
		{
			skill: "why",
			target: "./references/sources/linear.md",
			intent: "Condition the Linear playbook and its example operation names on the access this session actually exposes.",
			ops: [
				{
					kind: "replace",
					anchor: "Use the Linear MCP.",
					replacement:
						"Use whatever Linear access this session exposes: a native tool, an MCP server, or the Linear CLI. Inspect its help or schema first; operation names below are examples, so map them to the exposed interface rather than inventing a missing command. If none exists, record the gap.",
				},
			],
		},
		{
			skill: "why",
			target: "./references/sources/notion.md",
			intent: "Condition the Notion playbook and its example operation names on the access this session actually exposes.",
			ops: [
				{
					kind: "replace",
					anchor: "Use the Notion MCP.",
					replacement:
						"Use whatever Notion access this session exposes: a native tool, an MCP server, or a CLI. Inspect its help or schema first; operation names below are examples, so map them to the exposed interface rather than inventing a missing command. If none exists, record the gap.",
				},
			],
		},
		{
			skill: "why",
			target: "./references/sources/sentry.md",
			intent: "Condition the Sentry playbook and its example operation names on the access this session actually exposes.",
			ops: [
				{
					kind: "replace",
					anchor: "Use the Sentry MCP.",
					replacement:
						"Use whatever Sentry access this session exposes: a native tool, an MCP server, or a CLI. Inspect its help or schema first; operation names below are examples, so map them to the exposed interface rather than inventing a missing command. If none exists, record the gap.",
				},
			],
		},
		{
			skill: "why",
			target: "./references/sources/datadog.md",
			intent: "Condition the Datadog playbook and its example operation names on the access this session actually exposes.",
			ops: [
				{
					kind: "replace",
					anchor: "Use the Datadog MCP. Start broad, then narrow.",
					replacement:
						"Use whatever Datadog access this session exposes: a native tool, an MCP server, or a CLI. Inspect its help or schema first; operation names below are examples, so map them to the exposed interface rather than inventing a missing command. Start broad, then narrow. If none exists, record the gap.",
				},
			],
		},
		{
			skill: "why",
			target: "./references/sources/databricks.md",
			intent: "Condition the Databricks operation examples and notebook caveat on the SQL access this session actually exposes.",
			ops: [
				{
					kind: "replace",
					anchor: "Use the Databricks SQL MCP. Primary tool: `execute_sql_read_only`. If it returns a `statement_id`, poll with `poll_sql_result` rather than re-running.",
					replacement:
						"Use whatever Databricks SQL access this session exposes and inspect its help or schema first. When it provides `execute_sql_read_only`, use that operation; when it returns a `statement_id` and provides `poll_sql_result`, poll instead of re-running. Otherwise map the same read-only and polling behavior to the exposed operations rather than inventing those names.",
				},
				{
					kind: "replace",
					anchor: "**Not queryable via the SQL MCP.**",
					replacement: "**Not queryable through the SQL tool.**",
				},
				{
					kind: "replace",
					anchor: "- **Notebooks aren't queryable.** The SQL MCP can't see Databricks notebooks.",
					replacement:
						"- **Notebooks aren't queryable.** The SQL tool can't see Databricks notebooks.",
				},
			],
		},
		{
			skill: "why",
			target: "./references/sources/slack.md",
			intent: "Describe Slack tooling discovery and authentication as session-dependent instead of assuming one Slack MCP.",
			ops: [
				{
					kind: "replace",
					anchor: "Slack MCP tools vary. Check which Slack MCP is available and inspect its tool schema first. It may require `mcp_auth`.",
					replacement:
						"Slack tooling varies. Check what Slack access this session exposes and inspect its operations first. It may require authentication.",
				},
				{
					kind: "replace",
					anchor: "- **Auth failures.** If the MCP isn't authenticated, stop.",
					replacement:
						"- **Auth failures.** If the Slack tool isn't authenticated, stop.",
				},
			],
		},
		{
			skill: "why",
			target: "./references/synthesizer-prompt.md",
			intent: "Use session-exposed evidence tools, not assumed MCP or GitHub access, for citation checks and coverage gaps.",
			ops: [
				{
					kind: "replace",
					anchor: 'Or "Not searched. No matching MCP available in this environment."',
					replacement:
						'Or "Not searched. No matching evidence tool available in this environment."',
					expect: 6,
				},
				{
					kind: "replace",
					anchor: "check it by reading the codebase or calling MCP tools.",
					replacement:
						"check it by reading the codebase or using the evidence tools this run exposes.",
				},
				{
					kind: "replace",
					anchor: "such as a missing real-time team chat MCP",
					replacement: "such as unavailable real-time team chat access",
				},
				{
					kind: "replace",
					anchor: 'Or "Not searched. This should not happen because git and `gh` are always expected."',
					replacement:
						'Or "Not searched. The target was not in a Git checkout, or usable forge access was unavailable; record which source-control evidence could not be searched."',
				},
			],
		},
		{
			skill: "arena",
			target: "./SKILL.md",
			intent: "Track phases in durable Work, validate configured seats against the live catalog, and run candidates in isolated wktree-managed checkouts with independently evidenced model diversity.",
			ops: [
				{
					kind: "replace",
					anchor: "Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.",
					replacement:
						"Before launching anything, create or reuse a lake Work group for the arena and track one task per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify). Put the rubric, run ids, candidate paths, decisions, and verification result in the task notes so the arena survives a session handoff.",
				},
				{
					kind: "replace",
					anchor: "3. Pick the runners. Use the `arena runners` line in `~/.cursor/rules/pstack-models.mdc`. If the rule or that line is missing, default to one each on `claude-opus-5-5-xhigh` and `grok-4.7-xhigh-fast`. An `auto` or `inherit-parent` entry in this line means the parent model, so omit `model` for it. If the Task tool rejects a configured entry, run that seat on its family's default and say so. Families go by prefix: `claude-*`, and `grok-*` with `cursor-grok-*` and `composer-*`. A refused `composer-*` entry runs on `grok-4.7-xhigh-fast`. If the family has no default, or the Task tool rejects that default, use the closest valid slug of the same family from its error message, or drop the seat and say so when there is none. If dropped seats leave fewer than two runners, add runners until there are two, or one when the line has one entry. Run each added runner on a remaining runner's model, or omit `model` so it runs on the parent model when none remain, and say so. Spawn more runners when the arena covers multiple design directions. Use the same model N times when the work is generation-bound rather than judgment-sensitive. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.",
					replacement:
						"3. Pick the runners. Read the `arena runners` list in `.botlake/pstack-roles.md`, then verify every configured seat and effort against `bl agent catalog` before use. If the list is missing or an entry is invalid, choose only listed seats whose catalog purposes fit independent candidate generation, omitting `--effort` for live choices. Aim for at least two runners and prefer distinct catalog-listed models when judgment diversity matters; repeat a suitable seat only when the work is generation-bound or the catalog has no meaningful alternative. Preserve a configured one-entry panel as intentional. Start more runners when the arena covers multiple design directions. Do not infer model family from provider or guess a seat. Run mechanics are in [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill.",
					replacement:
						"4. Give each candidate a distinct branch and checkout created with `wktree add --branch <branch> --base-current` (or an explicit `--base`), then resolve its absolute path with `wktree path --branch <branch>`. If the task depends on uncommitted state, materialize the same scoped snapshot in every checkout before launch. Keep candidate outputs separate, per the **separate-before-serializing-shared-state** principle skill.",
				},
				{
					kind: "replace",
					anchor: "Spawn all N subagents in one message with `run_in_background: true`, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.",
					replacement:
						"Start all N candidate runs without waiting between them. Each complete brief names the task, absolute shared-grounding path, candidate checkout and output path, rubric-independent artifact requirement, and a short rationale naming alternatives considered and rejected. Start each run with its configured seat and checkout as `--cwd`, keep every run id, and observe settlement with bounded `bl await` as described in the shared adapter.",
				},
				{
					kind: "replace",
					anchor: "After all Phase B candidates complete, choose one model from the `arena cross-judge pool` line in `~/.cursor/rules/pstack-models.mdc`. If the rule or that line is missing, choose from `claude-opus-5-5-xhigh` and `grok-4.7-xhigh-fast`. Spawn one readonly judge subagent. The judge is never from the parent's family, as Phase A step 3 defines families. Try only the entries from another family, in pool order. An `auto` or `inherit-parent` entry is the parent model, so it never judges. With the default pool, a Claude parent gets `grok-4.7-xhigh-fast`. A parent from any other family gets `claude-opus-5-5-xhigh` first. If the Task tool rejects an entry, use a valid slug of the same model at the closest level or speed from the error message, or move to the next entry when there is none. If no entry from another family runs, try the default pool's entries from another family the same way. If none of those runs, skip the judge, pick the base alone in Phase D, and say so. If you do not know the parent's model, try the pool's real slugs in pool order and say that the family check did not run.",
					replacement:
						"After all Phase B candidates complete, read the `arena cross-judge pool` list in `.botlake/pstack-roles.md` and verify every configured seat and effort against `bl agent catalog`. If the pool is missing or invalid, choose a listed seat whose purpose fits comparative judgment and omit `--effort`. Use actual current-run metadata when the harness exposes it and expanded catalog metadata for judge candidates; prefer a different model family, treating provider as separate evidence rather than as the family. When current-run model evidence is unavailable, choose the strongest purpose fit and say cross-family independence was not established. Start one no-write judge run. If no suitable catalog seat starts, skip the judge, pick the base alone in Phase D, and say so.",
				},
			],
		},
		{
			skill: "interrogate",
			target: "./SKILL.md",
			intent: "Run adversaries on configured lake seats in wktree checkouts containing the same scoped tracked and untracked changes.",
			ops: [
				{
					kind: "replace",
					anchor: "Read the `interrogate reviewers` line in place of `arena runners`. Copy the scope's uncommitted changes into each worktree. Spawn each adversary as `generalPurpose`.",
					replacement:
						"Use the `interrogate reviewers` list, including optional efforts, in place of `arena runners`. Before launch, snapshot the named scope once: capture tracked changes with `git diff --binary HEAD` and list scoped untracked files with `git ls-files --others --exclude-standard`; apply and copy that same snapshot into every wktree-managed candidate checkout, excluding unrelated files. Start each adversary as a lake run with the brief below and its checkout as `--cwd`; mechanics are in [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
			],
		},
		{
			skill: "architect",
			target: "./SKILL.md",
			intent: "Track architecture phases in durable Work and validate role-table runners against the live catalog before use.",
			ops: [
				{
					kind: "replace",
					anchor: "Open a todolist with one entry per phase before starting.",
					replacement:
						"Before starting, create or reuse a lake Work group and track one task per phase. Record the grounding artifact, candidate run ids and paths, synthesis decision, approved deviations, and verification result in task notes.",
				},
				{
					kind: "replace",
					anchor: "Take the runners from the `architect runners` line in the `pstack-models.mdc` rule, in place of the `arena runners` line. If the rule or that line is missing, use `claude-opus-5-5-xhigh` and `grok-4.7-xhigh-fast`. Alias and rejected entries follow the runner rules in the **arena** skill's Phase A.",
					replacement:
						"Use the `architect runners` list from `.botlake/pstack-roles.md`, including optional efforts, in place of `arena runners`. Validate the list against the live catalog and apply the purpose-based fallback and diversity rules in the **arena** skill's Phase A when the role is missing or invalid. Run mechanics are in [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
			],
		},
		{
			skill: "architect",
			target: "./references/runner-prompt.md",
			intent: "Keep the carried architect runner brief consistent with wktree isolation and seat-based diversity.",
			ops: [
				{
					kind: "replace",
					anchor: "The orchestrator passes this file through to every parallel candidate runner during Phase B and fills in the variable inputs around it: the task, the Phase A grounding artifacts, the isolated working directory, and the path to write outputs. The working directory is a git worktree when available, otherwise a per-runner subdirectory under the sketch dir. What matters is independence between candidates.",
					replacement:
						"The orchestrator passes this file to every parallel candidate runner during Phase B and fills in the task, Phase A grounding artifacts, isolated checkout, and output path. Each working directory is a distinct checkout created and resolved through `wktree`; independence between candidates is required.",
				},
				{
					kind: "replace",
					anchor: "You are one of the parallel runners, each on a different model. Produce the best design your model can make. Don't hedge against the others. Differences between candidates are the signal used to pick a base and graft. Converging on a safe-looking middle defeats the exploration.",
					replacement:
						"You are one of the parallel runners, each assigned a seat from the architect panel. Produce the best design you can make. Don't hedge against the others. Differences between independent candidates are the signal used to pick a base and graft. Converging on a safe-looking middle defeats the exploration.",
				},
			],
		},
		{
			skill: "reflect",
			target: "./SKILL.md",
			intent: "Read this run's record through lake observation and the harness's own pointer, route reviewers through catalog-validated roles, and use session-exposed evidence and authoring guidance.",
			ops: [
				{
					kind: "replace",
					anchor: "description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.",
					replacement:
						"description: Start three parallel reviewer runs over the current run record, surface durable learnings, and route each to a concrete skill edit or backlog mechanism. Use when the user says reflect.",
				},
				{
					kind: "range",
					start: "## 1. Locate the active transcript",
					end: "If none matches, pass a tight digest of the session instead.\n",
					replacement: `## 1. Collect the run record

Before fanning out, gather this run's record: \`bl agent show RUN_ID\` and \`bl agent activity peek RUN_ID\` for your own run, plus the optional native transcript pointer this harness names for the session. Never glob a global transcript directory; that reads unrelated private chats. When the record is thin and no pointer exists, pass a tight digest of the session instead. The full mapping is in [\`../poteto-mode/references/botlake-tools.md\`](../poteto-mode/references/botlake-tools.md).
`,
				},
				{
					kind: "replace",
					anchor: "One message, three `Task` calls, `subagent_type: generalPurpose`, agent mode (`readonly: false`). Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references, and readonly strips MCPs.",
					replacement:
						"Start three reviewer runs together. Each brief forbids file edits and external mutations while allowing read-only use of the evidence tools that run actually exposes for tickets, chat threads, and observability traces named by the record.",
				},
				{
					kind: "replace",
					anchor: "Each reviewer and the synthesizer name a role line in the `pstack-models.mdc` rule and a default. Set `model` to that line's value, or to the default if the rule or the line is missing. Leave `model` unset when the value is `auto` or `inherit-parent`. If the Task tool rejects a slug, use the default and say so. If it rejects the default, use the closest valid slug of the same family from its error message. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.",
					replacement:
						"Each reviewer and the synthesizer name a role in `.botlake/pstack-roles.md`. Verify its seat and optional effort against `bl agent catalog` before use. If a role is missing or invalid, choose a listed seat by the lens's purpose and omit `--effort`; do not guess a seat or model slug.",
				},
				{
					kind: "replace",
					anchor: "| Lens | Role line | Default `model` | Prompt template |\n|---|---|---|---|\n| Judgment | `reflect judgment, divergent, synthesizer` | `claude-opus-5-5-xhigh` | `references/judgment-reviewer.md` |\n| Tooling | `reflect tooling` | `grok-4.7-xhigh-fast` | `references/tooling-reviewer.md` |\n| Divergent | `reflect judgment, divergent, synthesizer` | `claude-opus-5-5-xhigh` | `references/divergent-reviewer.md` |",
					replacement:
						"| Lens | Role line | Live-catalog purpose when missing | Prompt template |\n|---|---|---|---|\n| Judgment | `reflect judgment, divergent, synthesizer` | judgment and synthesis | `references/judgment-reviewer.md` |\n| Tooling | `reflect tooling` | fast code and tooling analysis | `references/tooling-reviewer.md` |\n| Divergent | `reflect judgment, divergent, synthesizer` | divergent judgment and synthesis | `references/divergent-reviewer.md` |",
				},
				{
					kind: "replace",
					anchor: "Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `Task` response body.",
					replacement:
						"Pass each template verbatim, substituting the record path or digest where marked. Reviewers return findings in their run record; read `bl agent show RUN_ID`.",
				},
				{
					kind: "replace",
					anchor: "One `Task` call, `subagent_type: generalPurpose`, `model` from the `reflect judgment, divergent, synthesizer` line (default `claude-opus-5-5-xhigh`), agent mode (`readonly: false`). It spot-verifies citations through MCP, and readonly strips MCPs.",
					replacement:
						"Start one synthesizer run using the `reflect judgment, divergent, synthesizer` role, or a live catalog seat suited to judgment and synthesis when that role is unavailable. Its brief forbids mutations and permits citation checks only through evidence tools the run exposes.",
				},
				{
					kind: "replace",
					anchor: "File each Backlog item to your team's devex or backlog tracker without waiting.",
					replacement:
						"File each Backlog item to the team's backlog through whatever tracker tool this session exposes, or record it in the lake work records when none is available, without waiting.",
				},
				{
					kind: "replace",
					anchor: "Never edit a skill under `plugins/cache/`. Before approval, show its destination, `.cursor/skills/<skill>/` or `~/.cursor/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. Never open a PR or push.",
					replacement:
						"Never edit the generated `.agents/skills/` output in place. Before approval, show the destination: the prepared source directory for that skill. After approval, edit that source and capture it through the product CLI when you are authorized. Never open a PR or push.",
				},
				{
					kind: "replace",
					anchor: "- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to Cursor's built-in `create-skill` skill and run its draft / test / iterate loop.",
					replacement:
						"- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the project's skill-authoring guidance (`skillbox-author` when installed) and run its draft / test / iterate loop.",
				},
				{
					kind: "replace",
					anchor: "- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `create-skill` and run its description-optimization loop.",
					replacement:
						"- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to the skill-authoring guidance and run its description-optimization loop.",
				},
				{
					kind: "replace",
					anchor: "- `new skill via create-skill: <kebab-name>`: hand creation to `create-skill`. Do not invent the shape ad hoc.",
					replacement:
						"- `new skill: <kebab-name>`: hand creation to the skill-authoring guidance. Do not invent the shape ad hoc.",
				},
				{
					kind: "replace",
					anchor: "- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.",
					replacement:
						"- Backlog filed (tracker issue or lake work record): `<issue title>` (`<tags>`). One line each.",
				},
			],
		},
		{
			skill: "reflect",
			target: "./references/divergent-reviewer.md",
			intent: "Count a skill as used through installed skills and agent records, and restrict context lookups to session-exposed read-only evidence tools.",
			ops: [
				{
					kind: "replace",
					anchor: "Do not modify files, write code, edit skills, or commit. The parent agent applies edits based on your output. Read code, and use any MCP tool available in your environment (e.g. a ticket tracker, chat, docs, observability, error tracker, source control) to look up context the transcript references, such as tickets and traces.",
					replacement:
						"Do not modify files or external state. The parent applies approved edits. Read code and use only read-only evidence tools this run actually exposes to look up tickets, chat, docs, observability, errors, or source history named by the record; report unavailable access as a gap.",
				},
				{
					kind: "replace",
					anchor: "A skill counts as used when the transcript shows a `Read` of its `SKILL.md` (under `.cursor/skills/`, `~/.cursor/skills/`, or `~/.cursor/plugins/`), a `Task` prompt naming its path, or a tool call (Shell, Grep, MCP, etc.) matching its documented commands.",
					replacement:
						"A skill counts as used when the record shows a read of its installed `SKILL.md` under `.agents/skills/`, an agent-run brief naming its path, or a tool call (shell, search, evidence tool) matching its documented commands.",
				},
				{
					kind: "replace",
					anchor: "Read the active transcript at <ABSOLUTE_PATH> (or use the digest below if no path is given).",
					replacement:
						"Read the run record or transcript at <PATH> (or use the digest below if no path is given).",
				},
			],
		},
		{
			skill: "reflect",
			target: "./references/judgment-reviewer.md",
			intent: "Count a skill as used through installed skills and agent records, and restrict context lookups to session-exposed read-only evidence tools.",
			ops: [
				{
					kind: "replace",
					anchor: "Do not modify files, write code, edit skills, or commit. The parent agent applies edits based on your output. Read code, and use any MCP tool available in your environment (e.g. a ticket tracker, chat, docs, observability, error tracker, source control) to look up context the transcript references, such as tickets and traces.",
					replacement:
						"Do not modify files or external state. The parent applies approved edits. Read code and use only read-only evidence tools this run actually exposes to look up tickets, chat, docs, observability, errors, or source history named by the record; report unavailable access as a gap.",
				},
				{
					kind: "replace",
					anchor: "A skill counts as used when the transcript shows a `Read` of its `SKILL.md` (under `.cursor/skills/`, `~/.cursor/skills/`, or `~/.cursor/plugins/`), a `Task` prompt naming its path, or a tool call (Shell, Grep, MCP, etc.) matching its documented commands.",
					replacement:
						"A skill counts as used when the record shows a read of its installed `SKILL.md` under `.agents/skills/`, an agent-run brief naming its path, or a tool call (shell, search, evidence tool) matching its documented commands.",
				},
				{
					kind: "replace",
					anchor: "Read the active transcript at <ABSOLUTE_PATH> (or use the digest below if no path is given).",
					replacement:
						"Read the run record or transcript at <PATH> (or use the digest below if no path is given).",
				},
			],
		},
		{
			skill: "reflect",
			target: "./references/tooling-reviewer.md",
			intent: "Count a skill as used through installed skills and agent records, and restrict context lookups to session-exposed read-only evidence tools.",
			ops: [
				{
					kind: "replace",
					anchor: "Do not modify files, write code, edit skills, or commit. The parent agent applies edits based on your output. Read code, and use any MCP tool available in your environment (e.g. a ticket tracker, chat, docs, observability, error tracker, source control) to look up context the transcript references, such as tickets and traces.",
					replacement:
						"Do not modify files or external state. The parent applies approved edits. Read code and use only read-only evidence tools this run actually exposes to look up tickets, chat, docs, observability, errors, or source history named by the record; report unavailable access as a gap.",
				},
				{
					kind: "replace",
					anchor: "A skill counts as used when the transcript shows a `Read` of its `SKILL.md` (under `.cursor/skills/`, `~/.cursor/skills/`, or `~/.cursor/plugins/`), a `Task` prompt naming its path, or a tool call (Shell, Grep, MCP, etc.) matching its documented commands.",
					replacement:
						"A skill counts as used when the record shows a read of its installed `SKILL.md` under `.agents/skills/`, an agent-run brief naming its path, or a tool call (shell, search, evidence tool) matching its documented commands.",
				},
				{
					kind: "replace",
					anchor: "Read the active transcript at <ABSOLUTE_PATH> (or use the digest below if no path is given).",
					replacement:
						"Read the run record or transcript at <PATH> (or use the digest below if no path is given).",
				},
			],
		},
		{
			skill: "reflect",
			target: "./references/synthesizer.md",
			intent: "Use session-exposed read-only evidence and the project's skill-authoring guidance in the synthesis contract.",
			ops: [
				{
					kind: "replace",
					anchor: "Synthesize three reviewers' findings from the active transcript into skill edits, backlog items, or rejections. Do not modify files. The parent applies the Accepted list after user approval. Use any MCP tool available in your environment to verify a finding (e.g. ticket, observability trace, chat thread).",
					replacement:
						"Synthesize three reviewers' findings from the current run record into skill edits, backlog items, or rejections. Do not modify files or external state. The parent applies the Accepted list after user approval. Verify findings only with read-only evidence tools this run actually exposes; record unavailable access as a gap.",
				},
				{
					kind: "replace",
					anchor: "- Existing-skill-first: propose `new skill via create-skill:` only when no existing skill is a real home, the pattern recurs, and the topic deserves its own skill.",
					replacement:
						"- Existing-skill-first: propose `new skill:` for creation through the project's skill-authoring guidance only when no existing skill is a real home, the pattern recurs, and the topic deserves its own skill.",
				},
				{
					kind: "replace",
					anchor: "| <new pattern, no existing skill is a real home> | <draft a new skill via create-skill> | <new skill via create-skill: <kebab-name>> |",
					replacement:
						"| <new pattern, no existing skill is a real home> | <draft a new skill with the project's authoring guidance> | <new skill: <kebab-name>> |",
				},
			],
		},
		{
			skill: "recall",
			target: "./SKILL.md",
			intent: "Rebuild recent context from lake agent, work, and Mail records instead of Cursor chat transcript paths, while keeping a native transcript as an optional pointer.",
			ops: [
				{
					kind: "replace",
					anchor: 'Transcripts live at `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-" (so `/Users/you/proj` becomes `Users-you-proj`). Every line is one chat message.',
					replacement:
						"Your run history lives in the lake: `bl agent list` and `bl agent show RUN_ID` for what you did, `bl work list` and `bl work show <id> --history` for tasks, criteria, and notes, and `bl mail list` for peer coordination. A native transcript is available only through the pointer this harness names for that run. Never read another project's history. The mapping is in [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md).",
				},
				{
					kind: "replace",
					anchor: "3. Fan out across your chat history. Spawn parallel subagents on a fast, cheap model, each taking a slice of the corpus. Tell every subagent to order candidates by real modification time (`ls -t`) and never by UUID name, grep the topic first and then read only the matching chats and only their relevant regions, and skip the current chat plus obvious noise (subagent, eval, and test chats). Each returns the same schema, one block per chat: topic, the user's goal, decisions, open threads, struggles and corrections, and artifacts (PRs, tickets, branches), each citing the chat UUID. For one or two chats, skip the fan-out and search directly. The raw transcripts stay in the subagents. The main thread gets only their findings. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.",
					replacement:
						"3. Fan out across your run history. Start parallel runs, each taking a slice of the record. Choose a live catalog seat whose purpose fits fast record search; use a configured project role only after verifying its seat and effort against the catalog, and otherwise omit `--effort`. Tell every run to order runs by last activity and never by id, search the topic first and then read only the matching records and their relevant regions, and skip the current run plus obvious noise (eval and test runs, unrelated work). Each returns the same schema, one block per run or task: topic, the user's goal, decisions, open threads, struggles and corrections, and artifacts (PRs, branches, work ids), each citing the run id. For one or two records, skip the fan-out and search directly. Raw records stay in the run. The main thread gets only their findings.",
				},
				{
					kind: "replace",
					anchor: "one investigator per source, null results are findings, skip an unavailable MCP and say so",
					replacement:
						"one investigator per source, null results are findings, skip an unavailable evidence tool and say so",
				},
				{
					kind: "replace",
					anchor: "5. Verify against live state. Take the PRs, branches, and tickets that the mining and the sweep surfaced and check them with `git` and `gh`. When the answer hinges on what an agent actually did (the tools it ran, files it read, errors it hit), read the full transcript, not just a trimmed local copy.",
					replacement:
						"5. Verify against live state. Check surfaced branches with `git`; check PRs and tickets only with authenticated forge or tracker tools this session exposes, without assuming `gh` or GitHub. When the answer hinges on what an agent actually did (the tools it ran, files it read, errors it hit), read the full run record and its optional transcript pointer, not just a summary.",
				},
				{
					kind: "replace",
					anchor: "cite chat findings by UUID and shared-record findings by their source (PR #, ticket ID, chat permalink, error-tracker issue)",
					replacement:
						"cite run findings by run id and shared-record findings by their source (PR #, ticket ID, work id, error-tracker issue)",
				},
			],
		},
	];
}
