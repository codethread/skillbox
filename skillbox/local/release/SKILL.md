---
name: release
description: Prepare, pack, publish, and verify @codethread/skillbox releases, including npm approval and registry propagation waits.
---

# Release Skillbox

Release only `@codethread/skillbox`. The `.botlake` lake and repository-local skills are not npm packages. Publishing is irreversible: obtain user agreement on the version and release scope before bumping or publishing. Loading this skill alone is not permission to publish.

Run commands from the repository root with Bun, Node.js, npm, Git, and (for GitHub releases) `gh` available. Set `SKILL_DIR` to the directory containing this file; after sync it is normally `.agents/skills/release`. The [verification script](scripts/verify-release.ts) works from either the source or installed skill directory.

## Prepare and freeze

1. Inspect the worktree, recent commits, previous release tag, and release task notes. Agree on the next version and release notes. Do not include unrelated edits. Check `npm whoami --registry https://registry.npmjs.org` has publish access to `@codethread`; confirm GitHub authentication if creating a release.
2. Edit the root `package.json` version directly, then run `bun install` to refresh `bun.lock`. Do not use a version command that creates a commit or tag before verification. The CLI imports the package version; do not maintain a second version string. Validate the frozen lock and run checks/build:

    ```sh
    bun install --frozen-lockfile
    bun run check
    bun run build
    ```

3. Pack and verify the exact candidate. Start with an empty release directory only for a **new** candidate, never when resuming an accepted publication:

    ```sh
    mkdir -p dist/release
    bun pm pack --destination dist/release --ignore-scripts
    bun "$SKILL_DIR/scripts/verify-release.ts" --packed
    ```

    `--ignore-scripts` is intentional: the build already ran. The verifier checks the exact archive file list, package metadata, MIT license and third-party notices; installs offline with a fresh npm cache and no install hooks; checks version flags, help, and bundled guidance; and runs add, restore, and repeated sync in disposable directories without a `package.json`. It verifies supporting resources, the Claude link, both tracking files, and preservation of an unrelated root lock. It cleans up on success or failure. This project has no application database to seed.

4. Commit the candidate. Record the commit, version, archive filename, and SHA-512 integrity printed by the verifier in the release task notes. Freeze those bytes: do not rebuild, repack, bump, or change release contents during approval/distribution waits. Re-run packed verification against the same archive after committing. If a candidate must change before publication, prepare and record a new candidate; after acceptance, changes require a new version.

## Publish and wait

Check npm against the frozen archive before any publish attempt:

```sh
bun "$SKILL_DIR/scripts/verify-release.ts"
```

```text
CHECK EXACT VERSION
  |
  +-- verified --> already published; finish Git/tag/release verification
  |
  +-- mismatch or non-404 error --> stop and investigate; do not publish
  |
  +-- unavailable --> recorded npm acceptance or tarball/latest-tag stage?
                        |
                        +-- yes --> wait, then check again
                        |
                        +-- no --> confirm no publisher is running;
                                   publish the frozen archive once
```

1. Exit `0` means npm metadata, downloaded bytes, `latest`, a fresh exact-version npm install, and CLI smoke checks passed. Exit `2` reports the unavailable stage; **it is not permission to publish**. Other failures stop the release. Never replace an available version or treat an integrity mismatch as propagation delay.
2. Only for an unpublished version with no successful acceptance recorded and no publish process still running, publish the exact filename printed by verification:

    ```sh
    npm publish dist/release/codethread-skillbox-VERSION.tgz \
      --registry https://registry.npmjs.org --access public --ignore-scripts
    ```

    Keep the publisher terminal alive. If npm prints a browser/OTP approval prompt, give the user the actual prompt/URL and wait for approval and the command's final result. Do not launch another publisher while approval is pending. Record npm's successful acceptance immediately, including timestamp and archive integrity. If the process disconnects or times out ambiguously, check its terminal, the registry, and acceptance notes; resolve uncertainty before any retry.

3. Newly accepted packages can return `404` for several minutes, even after version metadata appears. A tarball-stage `404` or lagging `latest` means **wait**, never republish. Re-run published verification after about 30 seconds, then 60 seconds, then every 120 seconds. After 10 minutes without completion, report the exact stage and arrange a later check; elapsed time never makes another publish safe. Authentication, rate-limit, network, malformed metadata, install, and integrity failures require investigation rather than blind retries. No automated publish/retry loop is provided.

## Finish

1. Once published verification passes, create an annotated `vVERSION` tag at the recorded candidate commit (or verify an existing tag points there). Push the candidate commit and exact tag without force.
2. Create or verify a GitHub release for that tag with the agreed user-facing changes, migration notes where needed, and verification results. Do not claim unimplemented PRD behavior. Use `gh release create vVERSION --verify-tag --title vVERSION --notes-file <notes-file>` after the tag is pushed.
3. Recheck `npm view @codethread/skillbox@VERSION version dist.integrity --registry https://registry.npmjs.org` and `npm view @codethread/skillbox dist-tags.latest --registry https://registry.npmjs.org`. Close the release task only after the archive matches npm, the installed CLI smoke passes, and the commit/tag/release are visible remotely. Record the links and verification output. Stop publisher terminals and remove disposable files; retain the frozen archive until completion.
