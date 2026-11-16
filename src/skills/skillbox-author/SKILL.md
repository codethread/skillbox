---
name: skillbox-author
description: Author or compose a publishable Skillbox bundle, keep producer and consumer changes separate, and verify it from a consuming project.
---

# Author Skillbox bundles

Edit owned sources, not generated installations. Propose changes useful to all consumers to the shared producer's maintainer. Keep project-specific changes in the consumer. Author a complementary skill or use `skillbox-patch` to customize an imported skill with intent.

For personal experiments, load `skillbox skills get skillbox-configure`. Keep personal sources outside the repository or in a separately ignored directory, then add them explicitly to local config. Native `skillbox/<id>/` bundles are shared exports, even when named `local`.

## Author native skills

1. Inspect existing bundle conventions. Create `skillbox/<id>/<skill-name>/SKILL.md`, with supporting resources inside that skill directory. Prefer lowercase kebab-case matching the frontmatter name for new skills. Preserve original directories and names when importing existing skills.
2. Give `SKILL.md` YAML `name` and `description`. Explain when to load it, give actionable instructions and observable completion criteria, and link detailed references relative to `SKILL.md`.
3. For a starter with a supporting resource, load:

    ```sh
    skillbox skills file skillbox-author references/example.md
    ```

A native directory implicitly contributes to its shared bundle id. It can coexist with imported contributions of the same id, provided skill names do not collide. A native-only producer needs no config or npm package.

Use `local` for repository-specific maintainer skills, such as `skillbox/local/release/SKILL.md`, and include `local` in `install` if this repository uses them. The name is a convention, not access control. Native bundles remain publishable regardless of installation selection.

## Compose without copying

For publication, ensure shared config is active before running `add`; the result reports the selected path. Record unchanged external skills as contributions rather than copying upstream files:

```sh
skillbox add skills owner/toolkit development --path skills --pick review --no-install
skillbox add skillbox owner/team development --bundle coding --no-install
```

Both contributions join shared `development`, alongside any `skillbox/development/` native skills. Use pick or omit to exclude unwanted members; collisions fail. Commit `skillbox/config.json` and `skillbox/lock.json`. Unchanged imports need no patch directories. Load `skillbox-configure` for selectors and personal composition.

All shared composed bundles are publishable; `install` only chooses which this project uses. Consumers read shared config, lock, and patches, never personal state. A producer may publish several bundles while installing only its maintainer bundle, or none at all. Consumers select named bundles or omit `--bundle` for all exports. Consumer patches and per-file intent stay consumer-owned.

If a collection-wide reason helps maintainers, explain it in existing repository prose. It supplements, rather than replaces, per-file patch intent; do not invent a bundle metadata file or schema.

## Verify as a consumer

1. Create an empty disposable directory outside the source repository. Use an absolute source path to avoid workspace ambiguity:

    ```sh
    skillbox --workspace <client-dir> add skillbox <absolute-source-repo> example --bundle development
    ```

2. Require `success: true`. Compare installed skill names, complete supporting files, and executable permissions against the expected composed output. Check `.claude/skills` links to `.agents/skills`, and inspect client config/root lock for the intended destination and provenance.
3. Remove only the disposable client's generated skills directory and Claude link. Keep config and lock, run sync to restore, then sync again and require unchanged contents.
4. For a composed producer, verify a bundle absent from its `install` list is still available to the client. Verify that personal config and patches do not affect exports. For immutable Git behavior, use a committed Git source, such as a `file://` repository URL, not a live filesystem path.
5. Remove the disposable client when finished. Commit shared authored sources, composition tracking files, and intentional patches. Give consumers the repository source and any bundle ids needed for selection.

Local filesystem sources reflect owned worktree edits. Git-backed consumers retain their pinned revision until an explicit reviewed update; publishing a new producer commit does not silently update them.
