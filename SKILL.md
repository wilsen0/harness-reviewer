---
name: harness-reviewer
description: Universal AI Governance Harness (v2.0.0). A closed-loop governance system that centrally manages rules and platform configuration in one place, enforcing them across Gemini CLI, Claude Code, and Codex CLI via automated hooks.
---

# Universal AI Harness (v2.0.0)

This skill transforms your AI workspace into a governed environment. It enforces core engineering principles through an automated "Interception → Audit → Reflection" loop, with per-session state for escalation and a structured self-review format (regex mode) / LLM-as-judge (LLM mode) audit.

## 🚀 One-Step Deployment

To install or sync the harness for all AI tools, simply ask:
> **"Install the harness reviewer here"**

Or run directly:
```bash
node scripts/install.cjs
```

The installer reads `harness.config.json` and registers hooks only for platforms you've enabled. Re-running the installer **merges** hooks (does not duplicate) and **preserves** any unrelated hooks in your settings file.

## 📊 Check Status

See which platforms are configured, whether hooks are actually installed, and current audit state:
```bash
node scripts/status.cjs
```

## ⚙️ Configuration

Everything is managed in one file: `harness.config.json` (or `harness.config.local.json` as override).

```json
{
  "version": 2,
  "platforms": {
    "gemini": { "enabled": true, "scope": "project" },
    "claude": { "enabled": true, "scope": "project" },
    "codex":  { "enabled": true, "scope": "global" }
  },
  "state_dir": null,
  "audit": {
    "mode": "regex",
    "dry_run": false,
    "llm_config": { "provider": "openai", "model": "...", "api_key": "...", "endpoint": "..." }
  },
  "kiro": { "auto_configure": false }
}
```

### Top-level fields:
| Field | Default | Description |
|-------|---------|-------------|
| `version` | `2` | Schema version. `status.cjs` warns if missing or outdated. |
| `state_dir` | `<cwd>/.harness/state/` or `~/.harness/state/` | Where per-session state files are stored. Codex global scope auto-uses `~/.harness/state/`. |
| `kiro.auto_configure` | `false` | When `true`, will also configure Kiro to use Codex CLI if both are detected. Opt-in to avoid side effects. |

### Platform settings:
| Field | Values | Description |
|-------|--------|-------------|
| `enabled` | `true` / `false` | Whether to install the hook for this platform |
| `scope` | `"project"` / `"global"` | Where to write the hook config |

- **project** scope: writes to `.gemini/settings.json` or `.claude/settings.json` in the current working directory.
- **global** scope: writes to `~/.gemini/settings.json` or `~/.claude/settings.json` (applies to all projects).
- **Codex** always uses global scope (`~/.codex/hooks.json`).
- The hook event is **fixed per platform**: `Gemini → AfterAgent`, `Claude → Stop`, `Codex → Stop`. Per-platform `hook_event` fields in config are ignored and warned about.

### Audit mode:
| Mode | Description |
|------|-------------|
| `regex` | Zero-latency local audit (default). Requires structured `## Self-Review` block. |
| `llm`   | Deep semantic audit via LLM (OpenAI-compatible). LLM judges reflection depth on its own. |

### Audit field reference:
| Field | Default | Description |
|-------|---------|-------------|
| `audit.mode` | `"regex"` | Audit mode |
| `audit.dry_run` | `false` | When `true`, harness logs `{decision, reason, scenario}` to stderr and exits 0 — **does not block**. Essential for testing. |
| `audit.llm_config` | — | Required for `mode: "llm"` or for auto-escalation in regex mode. |

## ⚖️ Governance Rules

All rules are centrally managed in: `rules.md`

### Core principles enforced:
1. **Focus**: Deep analysis of user core demands.
2. **Self-Critique**: Mandatory logic-conflict checks.
3. **First Principles**: KISS, root-cause analysis over patch-thinking.

### Structured self-review format (regex mode)

When intercepted in regex mode, the agent **must** append a `## Self-Review` block to its next response. Each scenario has a fixed field matrix:

| Scenario | Required fields (zh) | Required fields (en) |
|----------|----------------------|----------------------|
| `fix`    | 根因 / 副作用范围 / 边界情况 | root_cause / side_effects / edge_cases |
| `arch`   | KISS依据 / 边界情况 / 与现有结构冲突 | kiss_basis / edge_cases / conflicts_with_existing |
| `code`   | 逻辑冲突 / 边界情况 / 已有功能影响 | logic_conflicts / edge_cases / existing_impact |
| `design` | 核心诉求 / 逻辑冲突 / 第一性原理依据 | core_requirement / logic_conflicts / first_principles |

**Field verifier rules** (each field):
- Literal name match — no paraphrasing.
- Content after colon ≥ 30 characters.
- Content must contain a **concrete token**: a file path (`/foo.ts`, `src/bar.py`), a backtick-quoted symbol, a quoted phrase, or a mixed-case/PascalCase identifier ≥ 4 chars.
- Chinese **or** English field names accepted.
- Failed field is named in the deny reason — the agent only needs to fix that field, not rewrite the whole block.

The `## Self-Review` magic word from v1 (`已自检`) is **no longer accepted** — v1 users get a one-time migration challenge on first deny.

## 🔁 Per-Session State & Escalation

Each session gets a state file at `<state_dir>/<session_id>.json`. Harness behavior:

| Trigger | Behavior |
|---------|----------|
| `deny_count ≥ 2` in a session | Auto-escalate to `llm` mode (if `llm_config` present). One-shot — does not flip back. |
| `deny_count ≥ 4` in a session | **Hard block** — deny reason = "需要人工确认". Forces human intervention. |
| `consecutive_passes ≥ 3` | Reset `deny_count` to 0 (don't escalate on stale history). |
| State file older than 7 days | Pruned on next harness run. |

Writes are atomic (tmp + random suffix + rename), so concurrent harness invocations on the same session can't corrupt the state file.

**LLM escalation is one-shot.** Once a session's `effective_mode` flips to `llm`, it stays there for the lifetime of the state file. A clean streak (3+ consecutive passes) resets `deny_count` but does **not** revert to `regex` mode. To de-escalate, delete the session's `.json` file in `state_dir`.

## 🧪 Testing & Dry-Run

For E2E verification without triggering real hooks:
- Set `audit.dry_run: true` in config. Harness logs decisions to stderr and exits 0.
- Or set `HARNESS_DRY_RUN=1` env var (test-harness.cjs uses this).
- **Note:** dry-run mode still updates the session's state file (deny_count, consecutive_passes, effective_mode). This is intentional — the multi-step fixtures (escalation, hard-block, reset) rely on it. For one-off CLI testing, use a separate `state_dir` or a different `session_id` to avoid polluting real session state.
- Run the bundled fixture suite:
  ```bash
  node scripts/test-harness.cjs
  ```
  Covers all 4 scenario detectors, the self-review validator, the LLM-fail-closed path, the 2-deny escalation, the 4-deny hard-block, the 3-pass reset, and the v1→v2 migration challenge.

## 📋 Post-install Notes

- **Codex**: Run `/hooks` in Codex CLI to trust the new hook on first use.
- **Gemini**: Approve the hook trust prompt on first trigger.
- **Claude Code**: Active immediately.
- **Kiro**: NOT auto-configured. Set `kiro.auto_configure: true` in config to opt in.

## 🔄 Closed-Loop Evolution

Since the hooks are linked directly to this Skill's source code, any updates you make to `rules.md` or `scripts/harness-main.cjs` will be **immediately active** across all platforms without re-installation.

## 📁 Directory Structure

```
harness-reviewer/
├── scripts/
│   ├── install.cjs                  ← Registers hooks per config (merges, never overwrites)
│   ├── status.cjs                   ← Shows installation state + audit state
│   ├── harness-main.cjs             ← Audit kernel (runs on every agent stop)
│   ├── llm-client.cjs               ← LLM API client (with retry + fail-closed)
│   ├── state.cjs                    ← Per-session state file management
│   └── test-harness.cjs             ← E2E fixture test suite
├── harness.config.json              ← Default config (committed)
├── harness.config.example.json      ← Reference for LLM mode + local override
├── rules.md                         ← Governance rules (the "constitution")
├── VERSION                          ← Single source of truth for version
└── SKILL.md                         ← This file
```

## 🔄 v1 → v2 Migration

v1's `/已自检/i` magic word is **deleted** in v2 with no grace period — that was the bypass bug.

- **First deny** with a `已自检` magic word and no `## Self-Review` block: harness returns a one-time migration challenge that embeds the new format spec. State records `v1_magic_word_seen: true` so the migration challenge only fires once per session.
- **Existing state files** lacking `version: 2` are treated as new sessions (clean slate).
- **Existing config** lacking `version: 2` is flagged by `status.cjs` — re-run install to migrate.

## ❓ Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `status.cjs` shows "Schema version: ⚠️ unset" | Config missing `version: 2` | Add `"version": 2` to `harness.config.json` |
| Harness crashes on every call | `node` version < 14 or `state_dir` not writable | Check `node -v` and `ls <state_dir>` |
| LLM mode always denies with "LLM 审计不可用" | `llm_config` empty or `api_key` placeholder | Fill in `api_key` in `harness.config.local.json` (gitignored) |
| `state.cjs` reports 4 denies, won't reset | Hard-block is intentional — needs human confirmation | Delete the session's `.json` file in `state_dir` to reset |
