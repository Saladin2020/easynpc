# Easy NPC studio install plan (prepared, NOT applied)

Nothing below has been run against `/workspace/indie-studio`. Apply only after the user approves.

1. `git clone /workspace/easy-new/easynpc /workspace/indie-studio/tools/easynpc && cd $_ && git checkout --detach <SHA>`
2. `npm ci && npm run build && npm test` (Godot test skipped unless `GODOT=…`).
3. Copy `install-plan/easynpc-cli.mjs` → `/workspace/indie-studio/tools/easynpc-cli.mjs`.
4. Copy `install-plan/EASYNPC.md` → `/workspace/indie-studio/tools/EASYNPC.md` and replace `<SHA>`.
5. Smoke: `node /workspace/indie-studio/tools/easynpc-cli.mjs init --workspace /workspace/indie-studio/projects/_smoke_npc`
   then `check` and `export --preset godot` with the same `--workspace` (absolute paths: the wrapper runs in the install).
6. Shared skill: install `SKILL.draft.md` as `easynpc-village-schedules` (the parent agent does this).
7. Once a GitHub repo exists (user's call): add it as a remote in the install.

Ports: editor 8958, MCP HTTP 8959, Vite 5195.
