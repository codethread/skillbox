import { coreChanges } from "./changes/core.ts";
import { docsChanges } from "./changes/docs.ts";
import { playbookChanges } from "./changes/playbooks.ts";
import { otherSkillChanges } from "./changes/other-skills.ts";
import { reviewSkillChanges } from "./changes/review-skills.ts";

/** Exact official PSTACK pin: plugins repository commit and its subtree OIDs. */
export const PROVENANCE = {
	source: "https://github.com/cursor/plugins/tree/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack",
	baseRevision: "3dbd22ff12742fb28c9700b9760baa29ed41dc13",
	pstackTree: "4719e1c4b4c43bac85d4206a8b41dd2899769c1c",
	skillsTree: "8ffe53092c34afd8010a17d230681605ae16174b",
} as const;

/** The 58 distributed PSTACK skill identities, unchanged by this adaptation. */
export const SKILL_NAMES = [
	"architect",
	"arena",
	"automate-me",
	"benchmark-checklist",
	"blast-radius",
	"bro",
	"correct",
	"create-formal-verification-skill",
	"create-verification-skill",
	"figure-it-out",
	"how",
	"in-your-own-words",
	"interrogate",
	"ketchup",
	"ketchup-video",
	"maintain-formal-verification-skill",
	"maintain-verification-skill",
	"make-bot-ui",
	"no-comments",
	"poteto-help",
	"poteto-mode",
	"principle-attack-the-premise",
	"principle-boundary-discipline",
	"principle-build-the-lever",
	"principle-encode-lessons-in-structure",
	"principle-exhaust-the-design-space",
	"principle-experience-first",
	"principle-explain-the-number",
	"principle-fix-root-causes",
	"principle-foundational-thinking",
	"principle-guard-the-context-window",
	"principle-laziness-protocol",
	"principle-make-operations-idempotent",
	"principle-migrate-callers-then-delete-legacy-apis",
	"principle-minimize-reader-load",
	"principle-model-the-domain",
	"principle-never-block-on-the-human",
	"principle-outcome-oriented-execution",
	"principle-prove-it-works",
	"principle-redesign-from-first-principles",
	"principle-separate-before-serializing-shared-state",
	"principle-sequence-verifiable-units",
	"principle-subtract-before-you-add",
	"principle-test-behavior-not-implementation",
	"principle-type-system-discipline",
	"recall",
	"reflect",
	"setup-pstack",
	"sharpen",
	"show-me-your-work",
	"statechart",
	"swarm",
	"tdd",
	"teach",
	"technical-writing",
	"typescript-best-practices",
	"unslop",
	"why",
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

/** Replace an exact anchored span. `expect` is the exact occurrence count to replace. */
export type ReplaceOp = {
	kind: "replace";
	anchor: string;
	replacement: string;
	expect?: number;
};

/** Insert new text directly after an exact, unique anchor. */
export type InsertOp = {
	kind: "insertAfter";
	anchor: string;
	content: string;
	expect?: number;
};

/** Replace an inclusive span delimited by two unique anchors (whole-section rewrites). */
export type RangeOp = {
	kind: "range";
	start: string;
	end: string;
	replacement: string;
};

export type Op = ReplaceOp | InsertOp | RangeOp;

/** One changed, added, copied, or deleted file under `skills/`. */
export type FileEdit = {
	skill: SkillName;
	/** Path relative to the skill directory, written with a leading `./`. */
	target: string;
	/** Why this file changes. Becomes the intent record for the captured diff. */
	intent: string;
	ops?: Op[];
	/** Authored file content, used for a new file. */
	content?: string;
	/** Create this file from a pristine-source-relative path (docs carry-over). */
	copyFrom?: string;
	/** Remove the file. A deleted runtime-only helper is a genuine deletion. */
	delete?: boolean;
	/** Deliberately replace the whole file with `content`. */
	replace?: boolean;
};

export type Plan = {
	changes: FileEdit[];
};

/** Assembled plan in application order: core hubs, playbooks, then independent skills and carried docs. */
export function buildPlan(): Plan {
	const changes = [
		...coreChanges(),
		...playbookChanges(),
		...otherSkillChanges(),
		...reviewSkillChanges(),
		...docsChanges(),
	];
	const seen = new Set<string>();
	for (const change of changes) {
		const key = `${change.skill}/${change.target}`;
		if (seen.has(key)) throw new Error(`duplicate plan entry for ${key}`);
		seen.add(key);
	}
	return { changes };
}

export function targetPath(change: FileEdit): string {
	return change.target.replace(/^\.\//, "");
}

/** A residue rule turns a matched runtime primitive into a verifier failure with a fix. */
export type ResidueRule = {
	/** Human name used in the report. */
	id: string;
	/** JavaScript regular expression source, applied per line. */
	pattern: string;
	/** Actionable replacement guidance named in the failure. */
	action: string;
};

/**
 * Actionable Cursor runtime primitives. Every match fails verification.
 * The shared adapter reference
 * documents the Botlake replacement for each rule.
 */
export const RESIDUE_RULES: ResidueRule[] = [
	{
		id: "task-tool",
		pattern: "subagent_type|run_in_background|`Task`|Task (tool|call|subagent)",
		action: "start a lake agent run (`bl agent start`) or read references/botlake-tools.md",
	},
	{
		id: "cloud-agent",
		pattern: 'environment: "cloud"|cloud_base_branch|cloud (VM|agent)',
		action: "use an isolated local Git worktree and `bl agent start --cwd <worktree>`",
	},
	{
		id: "model-rule",
		pattern: "pstack-models\\.mdc",
		action: "read the role table `.botlake/pstack-roles.md` and `bl agent catalog`",
	},
	{
		id: "cursor-path",
		pattern: "\\.cursor/(rules|skills|projects|worktrees|plugins)|~/\\.cursor",
		action: "use the installed skill path, the lake records, or the harness session pointer",
	},
	{
		id: "transcript-path",
		pattern: "agent-transcripts",
		action: "use `bl agent show`/`bl agent activity peek`, or the harness's own session pointer",
	},
	{
		id: "loop-command",
		pattern: "/loop(?![\\w-])",
		action: "use the Autonomous run playbook with bounded `bl await` and a re-arm step",
	},
	{
		id: "control-skill",
		pattern: "control-ui|control-cli|cursor-team-kit|`deslop`|/deslop",
		action: "use the project's `verify-*` skill or a named driver; strip slop inline per Comments",
	},
	{
		id: "cursor-builtin",
		pattern:
			"create-skill|/add-plugin|Custom Mode|AskQuestion|SendToUser|update_state|api2\\.cursor\\.sh",
		action: "use the project's skill-authoring guidance, a plain chat question, or lake commands",
	},
	{
		id: "cursor-store",
		pattern: "Project (store|tracker)",
		action: "use lake work records (`bl work`) and notes",
	},
];

/** Files that must point at the shared adapter so independently invoked skills stay consistent. */
export const ADAPTER_POINTERS: Array<{ skill: SkillName; file: string }> = [
	{ skill: "poteto-mode", file: "./SKILL.md" },
	{ skill: "setup-pstack", file: "./SKILL.md" },
	{ skill: "poteto-help", file: "./SKILL.md" },
	{ skill: "how", file: "./SKILL.md" },
	{ skill: "why", file: "./SKILL.md" },
	{ skill: "swarm", file: "./SKILL.md" },
	{ skill: "arena", file: "./SKILL.md" },
	{ skill: "interrogate", file: "./SKILL.md" },
	{ skill: "reflect", file: "./SKILL.md" },
	{ skill: "recall", file: "./SKILL.md" },
	{ skill: "automate-me", file: "./SKILL.md" },
	{ skill: "no-comments", file: "./SKILL.md" },
	{ skill: "architect", file: "./SKILL.md" },
	{ skill: "create-verification-skill", file: "./SKILL.md" },
	{ skill: "maintain-verification-skill", file: "./SKILL.md" },
	{ skill: "show-me-your-work", file: "./SKILL.md" },
	{ skill: "make-bot-ui", file: "./SKILL.md" },
	{ skill: "poteto-mode", file: "./playbooks/orchestrate.md" },
	{ skill: "poteto-mode", file: "./playbooks/autonomous-run.md" },
	{ skill: "poteto-mode", file: "./playbooks/session-pickup.md" },
	{ skill: "poteto-mode", file: "./playbooks/pause-safely.md" },
	{ skill: "poteto-mode", file: "./playbooks/multi-phase-plan.md" },
	{ skill: "poteto-mode", file: "./playbooks/autopilot-full.md" },
	{ skill: "poteto-mode", file: "./playbooks/eval.md" },
	{ skill: "poteto-mode", file: "./playbooks/worktree-cleanup.md" },
	{ skill: "poteto-mode", file: "./playbooks/visual-parity.md" },
	{ skill: "poteto-mode", file: "./playbooks/runtime-forensics.md" },
	{ skill: "poteto-mode", file: "./playbooks/trace-forensics.md" },
	{ skill: "poteto-mode", file: "./playbooks/bug-fix.md" },
	{ skill: "poteto-mode", file: "./playbooks/babysit.md" },
	{ skill: "poteto-mode", file: "./playbooks/opening-a-pr.md" },
];
