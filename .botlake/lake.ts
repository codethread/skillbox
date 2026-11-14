import { createLake } from "@botlake/core";
import batteriesExtension from "@botlake/extension-batteries";
import { mailExtensions } from "./src/mail.ts";
import flags from "./src/flags.ts";
import references from "./src/references.ts";
import agents from "./src/agents.ts";
import priming from "./src/priming.ts";
import ui from "./src/ui.ts";
import work from "./src/work.ts";
import workAgents from "./src/work-agents.ts";

export const lake = createLake({
	name: "skillbox",
	extensions: [
		batteriesExtension,
		...mailExtensions,
		flags,
		references,
		agents,
		priming,
		ui,
		work,
		workAgents,
	],
});
