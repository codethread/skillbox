# Example source bundle

This source tree distributes one skill with one supporting reference:

```text
team-skills/
  skillbox/
    development/
      review-changes/
        SKILL.md
        references/
          checklist.md
```

## `skillbox/development/review-changes/SKILL.md`

```markdown
---
name: review-changes
description: Review a proposed code change for correctness, unintended effects, and missing user-visible verification.
---

# Review changes

1. Read the changed code and its callers. Identify the intended behavior from the request.
2. Follow [the review checklist](references/checklist.md) for the affected paths.
3. Verify the behavior through the project's supported public interface.
4. Report actionable findings with file locations, or state that no findings remain and list verification gaps.
```

## `skillbox/development/review-changes/references/checklist.md`

```markdown
# Review checklist

- Compare intended behavior with actual control flow and side effects.
- Check failure results through the public interface, not only internal helpers.
- Separate verified behavior from assumptions and untested paths.
```

From a separate consuming directory, install with:

```sh
skillbox add ../team-skills development
```

The installed skill is `.agents/skills/review-changes/SKILL.md`; the supporting file is `.agents/skills/review-changes/references/checklist.md`. These relative links must continue to resolve after installation. Symlinked source content is rejected; distribute real files and directories.
