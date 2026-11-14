# CT context for the PSTACK audience

This is evidence for the local adaptation policy, not another Botlake runbook. It was checked against this repository's selected CT config 0.5.1 descriptors. Recheck the installed sources when the configuration changes.

## Selected configuration

`.botlake/lake.ts` selects the descriptors re-exported by `.botlake/src/agents.ts`, `work.ts`, `priming.ts`, and `work-agents.ts` from `@botlake/extension-ct-config`. `.botlake/src/mail.ts` selects CT Mail and Mail–Agents alongside Identity. Installing the package alone would not establish activation; the lake's extension array does.

Inspect the current selection with `botlake lake info`. The preset's source and README are available through `.botlake/node_modules/@botlake/extension-ct-config/`. Its `src/roster.ts` defines agent prompts; `src/index.ts` defines configured descriptors and priming additions.

## Already supplied versus retrieved when needed

| Material | Loading evidence | Consequence for the port |
| --- | --- | --- |
| Botlake discovery and task tracking | CT roster prompts include Core and Work briefs. These direct agents to `bl prime`, lake documentation, Work tasks, groups, and gates. | “Track the tasks” can use the existing context; skill instructions need not reproduce Work commands. |
| Delegation | The configured Astra, Sol, Oracle, reviewer, and unmanaged prompts also include the Agents brief: prefer Botlake delegation, prime before use, and give delegates task inputs and outputs rather than mechanics. | Keep PSTACK's delegation goals, role distinctions, and evidence requirements. Use the configured catalog for the available runners. |
| Other seats | CT's lighter seats receive Core and Work briefs; the exact prompt composition varies by alias. | Do not claim every seat has identical context. Catalog, help, and priming provide the remaining discovery route. |
| Operation-specific rules | `bl prime work`, `bl prime agent`, and `bl prime mail` disclose current process and policy; `bl help` supplies command syntax. CT adds its local work and agent policy through the selected priming descriptor. | Avoid freezing the current command grammar, roster, waiting protocol, or ownership rules inside PSTACK. |
| Mail delivery | The selected preset configures provider notification adapters and Mail–Agents. | Delegates can coordinate through the environment's existing Mail guidance without a second handoff protocol in each skill. |
| Skillbox instructions | CLI help advertises `skills list`, `skills get`, and `skills file`. Those bodies are embedded in the CLI and loaded on demand. | Refer to that interface when Skillbox-specific authoring mechanics are needed. |
| Harness tools and repository skills | The active harness advertises its tools and skills; repository and ancestor instructions supply additional policy. | Preserve capability-based discovery. Do not assume a Cursor tool, transcript directory, UI driver, or globally installed skill exists. |

The brief definitions are in the installed packages: Core `src/runtime/priming.ts`, Work `src/index.ts`, and Agents `src/prompt.ts`. This establishes the configured loading path. Runtime availability still comes from the active lake and harness; a package dependency is not proof that a scheduler, UI driver, or particular model is enabled.

## What remains PSTACK's responsibility

Keep its engineering decisions: what to investigate, why to delegate, how roles differ, what evidence proves completion, and how to judge an alternative. CT context supplies the mechanics of recording tasks and running agents. A patch earns additional runtime explanation only where those existing instructions cannot preserve the original outcome.
