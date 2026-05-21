---
name: harness-reviewer
description: Universal AI Governance Harness (V4.1). A closed-loop governance system that centrally manages rules and platform configuration in one place, enforcing them across Gemini CLI, Claude Code, and Codex CLI via automated hooks.
---

# Universal AI Harness (V4.1)

This skill transforms your AI workspace into a governed environment. It enforces core engineering principles through an automated "Interception -> Audit -> Reflection" loop.

## 🚀 One-Step Deployment

To install or sync the harness for all AI tools, simply ask:
> **"Install the harness reviewer here"**

Or run directly:
```bash
node scripts/install.cjs
```

The installer reads `harness.config.json` and registers hooks only for platforms you've enabled.

## 📊 Check Status

See which platforms are configured and whether hooks are actually installed:
```bash
node scripts/status.cjs
```

## ⚙️ Configuration

Everything is managed in one file: `harness.config.json`

```json
{
  "platforms": {
    "gemini": { "enabled": true, "scope": "project" },
    "claude": { "enabled": true, "scope": "project" },
    "codex":  { "enabled": true, "scope": "global" }
  },
  "audit": {
    "mode": "regex",
    "llm_config": { ... }
  }
}
```

### Platform settings:
| Field | Values | Description |
|-------|--------|-------------|
| `enabled` | `true` / `false` | Whether to install the hook for this platform |
| `scope` | `"project"` / `"global"` | Where to write the hook config |

- **project** scope: writes to `.gemini/settings.json` or `.claude/settings.json` in the current working directory.
- **global** scope: writes to `~/.gemini/settings.json` or `~/.claude/settings.json` (applies to all projects).
- **Codex** always uses global scope (`~/.codex/hooks.json`).

### Audit mode:
| Mode | Description |
|------|-------------|
| `regex` | Zero-latency local scoring (default). No API calls needed. |
| `llm` | Deep semantic audit via LLM. Requires `llm_config` with provider/model/api_key/endpoint. |

## ⚖️ Governance Rules

All rules are centrally managed in: `rules.md`

### Core Principles enforced:
1. **Focus**: Deep analysis of user core demands.
2. **Self-Critique**: Mandatory logic conflict checks.
3. **First Principles**: Adherence to KISS and root-cause analysis.

## 📋 Post-install Notes

- **Codex**: Run `/hooks` in Codex CLI to trust the new hook on first use.
- **Gemini**: Approve the hook trust prompt on first trigger.
- **Claude Code**: Active immediately.
- **Kiro**: If Codex CLI is on PATH, Kiro is auto-configured to use it.

## 🔄 Closed-Loop Evolution

Since the hooks are linked directly to this Skill's source code, any updates you make to `rules.md` or `scripts/harness-main.cjs` will be **immediately active** across all platforms without re-installation.

**Required Action:** When intercepted by the Harness, you must perform a self-review according to the soul-searching questions and confirm with "已自检".

## 📁 Directory Structure

```
harness-reviewer/
├── config/
│   ├── harness-config.json          ← Your config (platforms + audit mode)
│   └── harness-config.example.json  ← Reference for LLM mode setup
├── scripts/
│   ├── install.cjs                  ← Registers hooks per config
│   ├── status.cjs                   ← Shows current installation state
│   ├── harness-main.cjs             ← Audit kernel (runs on every agent stop)
│   └── llm-client.cjs              ← LLM API client for deep audit mode
├── rules.md                         ← Governance rules (the "constitution")
└── SKILL.md                         ← This file
```
