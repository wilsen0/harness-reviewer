---
name: harness-reviewer
description: Universal AI Governance Harness (V4.0). A closed-loop governance system that centrally manages rules in rules.md and enforces them across Gemini, Claude, and Codex via automated hooks.
---

# Universal AI Harness (V4.0)

This skill transforms your AI workspace into a governed environment. It enforces core engineering principles through an automated "Interception -> Audit -> Reflection" loop.

## 🚀 One-Step Deployment

To install or sync the harness for all AI tools in this workspace (Gemini, Claude, Codex), simply ask:
> **"Install the harness reviewer here"**

The agent will automatically link the platform hooks to this Skill's centralized kernel.
For Codex, installation writes global `~/.codex/hooks.json`, enables the `codex_hooks` feature in `~/.codex/config.toml`, removes the legacy `notify` fallback from `~/.codex/config.toml`, and creates `~/.codex/harness-config.json`.
If Kiro is installed, the installer also writes `chatgpt.cliExecutable` in `~/.config/Kiro/User/settings.json` so Kiro uses the same external Codex CLI that supports native hooks.

## ⚖️ Governance Source of Truth

All rules are centrally managed in:
`references/rules.md`

### Core Principles enforced:
1. **Focus**: Deep analysis of user core demands.
2. **Self-Critique**: Mandatory logic conflict checks.
3. **First Principles**: Adherence to KISS and root-cause analysis.

## 🛠 Advanced LLM Mode

By default, the harness uses local Regex for zero-latency auditing. For deep semantic oversight, enable **LLM Mode**:

1. Edit `.gemini/harness-config.json`, `.claude/harness-config.json`, or `~/.codex/harness-config.json`.
2. Set `"mode": "llm"`.
3. Configure your `llm_config` (supports OpenRouter, OpenAI, Ollama).

## 🔄 Closed-Loop Evolution

Since the hooks are linked directly to this Skill's source code, any updates you make to the rules in `references/rules.md` or the logic in `scripts/harness-main.cjs` will be **immediately active** across all platforms without re-installation.

**Required Action:** When intercepted by the Harness, you must perform a self-review according to the soul-searching questions and confirm with "已自检".
