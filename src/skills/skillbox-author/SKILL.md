---
name: skillbox-author
description: Author or extend a Skillbox source bundle with SKILL.md instructions and supporting resources, then verify installation in a consuming project.
---

# Author Skillbox bundles

Extend skills in an owned source repository, not in a client's generated installation. To customize third-party plugin skills while retaining their upstream source and patch intent, load `skillbox skills get skillbox-patch`.

Use `local` as the bundle name for repository-specific maintainer skills (for example, `skillbox/local/release/SKILL.md`), rather than implying they are intended for public reuse. Select that bundle from source `"."` in the repository's own config. This is a naming convention, not access control; files in a public repository remain public.

1. Inspect the source repository's existing `skillbox/<bundle>/` layout and conventions. Create each skill at `skillbox/<bundle>/<skill-name>/SKILL.md`; keep its supporting resources inside that skill directory. Use lowercase kebab-case for the skill name and match the directory name to the frontmatter name. Selected bundles/sources must not install duplicate skill names.
2. Give `SKILL.md` YAML frontmatter with `name` and `description`. The description tells an agent when to load the skill. Write an actionable body with observable completion criteria. Keep branch-specific examples or detailed reference material in supporting files and link to them relative to `SKILL.md`.
3. For a complete starter with a supporting resource, load:

    ```sh
    skillbox skills file skillbox-author references/example.md
    ```

4. Create a disposable, empty consuming directory outside the source repository. Run `skillbox --workspace <client-dir> add <source-repo-path> <bundle>`. The source path is relative to the invocation directory, not the client directory; using an absolute path avoids ambiguity.
5. Require `success: true`. Compare the installed `.agents/skills/<skill-name>/SKILL.md` and every supporting file with the source. Check that `.claude/skills` resolves to `.agents/skills`. Inspect both `skillbox/config.json` and `skillbox/lock.json` in the client for the expected selection and skill entries.
6. Remove only the disposable client's generated `.agents/skills` directory and `.claude/skills` link, leaving its config and lock. Run `skillbox --workspace <client-dir> sync`; require the same installed contents. Run sync again and require an unchanged outcome. Remove the disposable client when finished.
7. Commit the source skill and resources. Source repositories do not need an npm package. Give consumers the repository source plus bundle names, or a GitHub tree URL ending in `skillbox/<bundle>`.

When editing an existing native source, test the changed content in a fresh disposable client. Repeating `add` in an already-configured client does not refresh it; sync rejects content that differs from saved hashes. The `update` command advances adapted bundles with patch tracking; it does not update native bundles.

For consuming-project configuration or add/sync diagnostics, use `skillbox skills get skillbox-configure`.
