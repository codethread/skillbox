---
name: blackbox-testing
description: Use when testing a CLI through its public command boundary with real files and subprocesses.
---

# Black-box CLI tests

1. Create a fresh directory beneath `/tmp` for each test.
2. Run the CLI as a subprocess with that directory as its working directory.
3. Assert its exit code, stdout, stderr, and resulting files.
4. Use inline snapshots for readable text payloads; use external snapshots when escaping obscures the content.
5. Remove the disposable directory after the test, including when assertions fail.

Before finishing, check [the filesystem assertions](references/filesystem.md).
