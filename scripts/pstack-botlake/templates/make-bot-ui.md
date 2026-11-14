---
name: make-bot-ui
description: >-
    Use when the user wants a Botlake UI: a page, dashboard, or buttons that show lake work or invoke a narrow registered lake command. Discovers the configured UI first, and proves any custom action against real lake state.
---

# Make a Botlake UI

A Botlake UI is two things: the lake's own views for watching work, and, when the user asks for one, a small local page whose buttons invoke a narrow, registered lake command. Discover available commands and integrations before choosing the action path. Do not assume a webhook, routine, sender key, or agent-wake API exists. Read [`../poteto-mode/references/botlake-tools.md`](../poteto-mode/references/botlake-tools.md) for the lake operations named here.

## 1. Start from the configured UI

```sh
botlake bin list
botlake bin run ui --help
```

The registered binary supplies the socket and workspace. Use the built-in views for status:

- `botlake bin run ui open <task-or-agent-id> --device phone` opens a task, group, or agent on the enrolled device.
- `botlake bin run ui show` displays work on one foreground client and waits for acknowledgement.
- `botlake bin run ui clients list` shows connected clients; `views list` and `settings get` read saved views.

These are viewer and notifier operations. They do not run a page or accept input. A button that starts work needs a separate, explicit action path using a registered command; the viewer itself is not that path.

## 2. If the user asks for a custom page

Build a local server that:

- serves the page and its static assets;
- exposes only the specific actions the page needs, each mapped to one registered lake command;
- validates every input against a narrow shape before it reaches the command, such as a task id, a work id, or a seat name from `bl agent catalog`;
- runs the command with an argument vector, never a shell string built from page input;
- reports the command's JSON outcome to the page, and keeps its own log.

Choose the narrowest commands that meet the request. Read their help first (`bl help <op>`, `bl prime <op>`). A status page usually needs `bl work show`, `bl work tree`, or `bl agent list`. An action page might need one `bl work create`, `bl work update`, or `bl agent start`. Never expose a general command runner.

Keep credentials and lake handles server-side. Keep tokens and socket paths out of the browser. If the action allows seat selection, validate it against the permitted catalog seats on the server.

## 3. Prove it before handing it over

For a status page, compare displayed values with a direct lake read. For an action page, exercise one harmless authorized action end to end: load the page, trigger it, then read the lake state directly (`bl work show <id>`, `bl agent show <run>`) and confirm the expected change. Capture the command output and read-back as evidence.

Report plainly:

- which built-in views cover the request;
- which actions the custom page performs, and which lake command each maps to;
- what the proof showed;
- that the lake UI is a viewer and notifier, not a page-to-agent trigger.

## 4. Exposure

Bind the server to localhost by default. Expose it beyond the machine only when the user asks, and follow the project's conventions for tunnels, auth, and secrets. Do not install or configure a remote access service unprompted.
