import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface CliResponse {
	success: boolean;
	data: unknown;
	errors: unknown[];
}

async function run(...args: string[]): Promise<CommandResult> {
	const child = Bun.spawn([process.execPath, cli, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1", DO_NOT_TRACK: "1" },
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

function expectFailure(result: CommandResult): CliResponse {
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toBe("");
	const response = JSON.parse(result.stdout) as CliResponse;
	expect(response.success).toBe(false);
	return response;
}

test("returns a structured JSON error for invalid command arguments", async () => {
	expect(expectFailure(await run("add"))).toMatchInlineSnapshot(`
	  {
	    "data": null,
	    "errors": [
	      {
	        "code": "CLI_PARSE_ERROR",
	        "message": "missing required argument 'source'",
	      },
	    ],
	    "success": false,
	  }
	`);
});
