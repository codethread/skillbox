# Filesystem assertions

- Compare installed file contents, not only their existence.
- Verify supporting resources are copied with the skill.
- Inspect symlink targets with `readlink`, then read through the link.
- For rejected operations, verify existing user files remain unchanged.
