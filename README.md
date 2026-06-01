<p align="center">
  <img src="assets/banner.svg" alt="Harness Reviewer Banner" width="640"/>
</p>

<p align="center">
  <strong>给你的 AI 助手套上"紧箍咒"</strong><br/>
  跨平台 AI Agent Skill · 让 AI 学会三思而后行
</p>

<p align="center">
  <img src="https://img.shields.io/badge/type-Agent%20Skill-purple" alt="Type"/>
  <img src="https://img.shields.io/badge/platforms-Gemini%20%7C%20Claude%20%7C%20Codex-blue" alt="Platforms"/>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License"/>
  <img src="https://img.shields.io/badge/v2.0.0-governance-orange" alt="Version"/>
</p>

---

## 这是什么？

这是一个 **Agent Skill**（AI 代理技能），通过各平台的 Hook 机制自动注入到 AI 的工作流中。它不是一个独立应用，而是寄生在你已有的 AI 工具（Gemini CLI / Claude Code / Codex CLI）上的治理层。

**工作方式：** 每当 AI 完成一轮输出准备交付时，Skill 自动拦截并审计输出质量，要求 AI 进行结构化自我检查后才放行。

**兼容平台：**
| 平台 | Skill 机制 | Hook 事件 |
|------|-----------|-----------|
| Gemini CLI | [Agent Skills](https://geminicli.com/docs/cli/tutorials/skills-getting-started/) | `AfterAgent` |
| Claude Code | [Hooks](https://code.claude.com/docs/en/hooks) | `Stop` |
| Codex CLI | [Hooks](https://developers.openai.com/codex/hooks/) | `Stop` |

## 😤 问题

你的 AI 助手是不是这样的：

- 方案写完就交，从不回头检查
- 修 bug 只贴创可贴，不找根因
- 代码越写越复杂，KISS 原则是什么？能吃吗？
- 你说"帮我重构"，它给你堆了三层抽象

## 💡 方案

请一位**铁面判官**坐镇。每当 AI 准备交付时，判官跳出来灵魂拷问：

> 🤔 "你真的找到问题根源了吗？还是在贴创可贴？"
>
> 🧐 "交卷之前，你重新检查过逻辑冲突没？"
>
> 🪞 "这玩意儿符合 KISS 原则吗？还是在炫技？"

AI 必须老老实实做完结构化自我反思，判官才会放行。

## 🔄 工作流程

```
AI 输出方案 → 判官拦截 🚨 → 灵魂质询 🔥 → AI 结构化自检 → 合格放行 ✅
                                                          ↑
                                          多次未通过？升级 LLM 复核 🧠
                                          累计 4 次？强制人工确认 🛑
```

## ⚡ 快速开始

### 方式一：作为 Skill 使用（推荐）

**Gemini CLI：**
```bash
git clone https://github.com/user/harness-reviewer.git ~/.gemini/skills/harness-reviewer
node ~/.gemini/skills/harness-reviewer/scripts/install.cjs
```

**Claude Code：**
```bash
git clone https://github.com/user/harness-reviewer.git ~/.claude/skills/harness-reviewer
node ~/.claude/skills/harness-reviewer/scripts/install.cjs
```

**Codex CLI：**
```bash
git clone https://github.com/user/harness-reviewer.git ~/.codex/skills/harness-reviewer
node ~/.codex/skills/harness-reviewer/scripts/install.cjs
```

### 方式二：独立安装

```bash
git clone https://github.com/user/harness-reviewer.git
cd harness-reviewer
node scripts/install.cjs
```

### 配置（可选）

默认配置开箱即用（regex 模式，三平台全部启用）。如需自定义：

```bash
# 编辑默认配置
vim harness.config.json

# 或创建本地覆盖（不会被 git 追踪，适合填 API Key）
cp harness.config.example.json harness.config.local.json
vim harness.config.local.json
```

完整配置结构（v2 schema）：

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
    "dry_run": false
  },
  "kiro": { "auto_configure": false }
}
```

- `enabled`: 是否为该平台安装 hook
- `scope`: `"project"`（写入当前目录的 `.gemini/` 或 `.claude/`）或 `"global"`（写入 `~/` 下的全局配置）
- `mode`: `"regex"`（免费零延迟，本地结构化校验）或 `"llm"`（语义审计，需配置 API Key）
- `dry_run`: `true` 时只记录不拦截，便于测试
- `state_dir`: 自定义会话状态文件目录（默认 `<cwd>/.harness/state/` 或 `~/.harness/state/`）
- `kiro.auto_configure`: 默认 `false`，开启后会同时配置 Kiro 走 Codex CLI

### 安装

```bash
node scripts/install.cjs
```

再次运行安装器**不会重复注册 hook**（按命令名匹配做合并），也不会清空你已有的其它 hook。

### 查看状态

```bash
node scripts/status.cjs
```

### 安装后注意

| 平台 | 首次使用 |
|------|----------|
| Gemini CLI | 首次触发时需要确认信任 hook |
| Claude Code | 立即生效 |
| Codex CLI | 运行 `/hooks` 命令信任 hook |

## 🎛️ 两种审计模式

| 模式 | 原理 | 延迟 | 成本 | 适合 |
|------|------|------|------|------|
| `regex` | 本地结构化校验（解析 `## Self-Review` 段） | ~0ms | 免费 | 日常开发 |
| `llm` | 外部 LLM 语义审计 | ~2-5s | 按调用计费 | 重要项目 |

`regex` 模式不是简单的关键词匹配——它解析 agent 输出中的 `## Self-Review` 段，按场景对应的字段矩阵逐字段校验（每条字段 ≥ 30 字符 + 必须包含具体凭证）。日常闲聊不会被打扰。

### 启用 LLM 模式

```bash
cp harness.config.example.json harness.config.local.json
```

编辑 `harness.config.local.json`，设置 `mode` 为 `"llm"` 并填入 API Key：

```json
{
  "audit": {
    "mode": "llm",
    "llm_config": {
      "provider": "openai",
      "model": "qwen/qwen3.6-plus-preview:free",
      "api_key": "your-key-here",
      "endpoint": "https://openrouter.ai/api/v1/chat/completions"
    }
  }
}
```

兼容所有 OpenAI Chat Completions API 格式的服务（OpenRouter / OpenAI / Ollama / vLLM / LocalAI）。

## 🔁 升级与硬拦截

每个会话有独立的状态文件（位于 `state_dir`），判官会记住这个会话"翻了几次车"：

| 累计拦截次数 | 行为 |
|--------------|------|
| 0-1 | regex 模式按字段矩阵校验 |
| ≥ 2 | 自动升级到 LLM 模式（如果配置了 `llm_config`） |
| ≥ 4 | **硬拦截**：reason = "需要人工确认"，要求人工放行 |
| 连续 3 次通过 | 重置拦截计数（避免历史包袱导致误升级） |

状态文件 7 天未活动自动清理。写入是原子的（tmp + rename），并发安全。

## 📝 Self-Review 字段矩阵

regex 模式下被拦截后，agent 必须在回复末尾添加 `## Self-Review` 段。每种场景字段不同：

| 场景 | 必填字段（中英文任一） |
|------|------------------------|
| `fix`（修 bug） | 根因 / 副作用范围 / 边界情况 |
| `arch`（架构/重构） | KISS依据 / 边界情况 / 与现有结构冲突 |
| `code`（提交代码） | 逻辑冲突 / 边界情况 / 已有功能影响 |
| `design`（设计方案） | 核心诉求 / 逻辑冲突 / 第一性原理依据 |

**字段校验规则：**
- 字段名必须是上表中的字面字符串，不能造词。
- 内容长度 ≥ 30 字符。
- 内容必须包含至少一个**具体凭证**：文件路径（`/foo.ts`）、反引号包裹的符号（`` `SessionManager` ``）、带引号的引用（`"已撤销 token"`）、或混合大小写/帕斯卡命名的标识符。

`fix` 场景示例：

```markdown
## Self-Review
- 根因: 通过查看 `src/auth/session.ts` 第 42 行的 token 解码逻辑，问题是过期时间检查没有考虑 clock skew。
- 副作用范围: 影响 `SessionManager.refresh` 调用方，目前只有 login flow 走这里，已通过 `grep -r refresh` 确认无其他引用。
- 边界情况: 已考虑空 token、已撤销 token、跨时区客户端三种情况。
```

只写"已自检"三个字在 v2 中**不再放行**。未通过的字段会出现在拦截原因里，agent 只需补齐这些字段，不用重写整段。

## 🔄 v1 → v2 迁移

v1 的 `已自检` 魔法词已被删除——这是它最大的设计漏洞（一次输入就能绕开所有审计）。

- **第一次**被拦截且回复中包含 `已自检` 但没有 `## Self-Review` 段：判官会返回一段"迁移提示"，内嵌完整的字段格式说明。状态文件记录 `v1_magic_word_seen: true`，这次提示只发一次。
- 旧版本的状态文件（缺少 `version: 2`）会被当作全新会话处理。
- 旧版本的配置（缺少 `version: 2`）会在 `status.cjs` 中报警，重新运行 `install.cjs` 即可迁移。

## 🧪 测试

```bash
node scripts/test-harness.cjs
```

跑一遍内置 fixture：覆盖全部 4 种场景检测器、self-review 字段校验、LLM 失败降级、2 次拦截升级、4 次拦截硬拦截、3 次通过重置，以及 v1→v2 迁移路径。

也可以手动用 dry-run 模式单条测：

```bash
echo '{"session_id":"t","last_assistant_message":"我修复了 X..."}' \
  | HARNESS_DRY_RUN=1 node scripts/harness-main.cjs
```

## 📁 项目结构

```
harness-reviewer/
├── scripts/
│   ├── install.cjs                    ← 安装器（按配置注册 hook，合并而非覆盖）
│   ├── status.cjs                     ← 状态检查
│   ├── harness-main.cjs              ← 审计内核
│   ├── llm-client.cjs                ← LLM 调用客户端
│   ├── state.cjs                     ← 会话状态文件管理
│   └── test-harness.cjs              ← E2E fixture 测试
├── harness.config.json                ← 默认配置（提交到 git）
├── harness.config.local.json          ← 本地覆盖（gitignored，放 API Key）
├── harness.config.example.json        ← LLM 模式配置示例
├── rules.md                           ← 治理规则（判官的灵魂）
├── VERSION                            ← 版本号（单一来源）
├── SKILL.md                           ← 技能元数据
└── README.md                          ← 你在这里 👋
```

## ❓ FAQ

<details>
<summary><b>AI 被拦截后怎么办？</b></summary>

Agent 需要在回复末尾添加 `## Self-Review` 段，按当前场景对应的字段矩阵填写（每条字段 ≥ 30 字符 + 至少一个具体凭证）。判官只检查不写内容——agent 自己想清楚再写。

LLM 模式下不需要这个结构——LLM 会自己判断反思深度。
</details>

<details>
<summary><b>会不会太烦？</b></summary>

不会。只有当输出"看起来像在交付方案"时才触发（场景检测器：fix/arch/code/design 四种）。问个问题、聊个天、看个纯报告，都不会被拦。
</details>

<details>
<summary><b>regex 模式会误判吗？</b></summary>

偶尔会。它按场景检测器 + 字段矩阵的结构化校验来降低误判率，失败的字段会明确告诉 agent。如果觉得不够准，切 LLM 模式。
</details>

<details>
<summary><b>支持哪些 LLM 服务？</b></summary>

任何兼容 OpenAI Chat Completions API 的服务都行：OpenRouter、OpenAI、Azure OpenAI、Ollama、vLLM、LocalAI……
</details>

<details>
<summary><b>规则改了需要重新安装吗？</b></summary>

不需要。Hook 直接引用源文件路径，改完 `rules.md` 立即生效。
</details>

<details>
<summary><b>怎么只给某个平台装？</b></summary>

编辑 `harness.config.json`，把不需要的平台 `enabled` 设为 `false`，然后重新 `node scripts/install.cjs`。
</details>

<details>
<summary><b>project scope 和 global scope 有什么区别？</b></summary>

- `project`: hook 只在当前项目目录生效（写入 `.gemini/settings.json` 或 `.claude/settings.json`）
- `global`: hook 对所有项目生效（写入 `~/.gemini/settings.json` 或 `~/.claude/settings.json`）
- Codex 只支持 global scope
</details>

<details>
<summary><b>怎么调试？</b></summary>

用 dry-run 模式：
```bash
echo '{"session_id":"t","last_assistant_message":"我修复了 X..."}' \
  | HARNESS_DRY_RUN=1 node scripts/harness-main.cjs
```
判官的决策会以 JSON 形式输出到 stderr，不会真的拦截。
</details>

<details>
<summary><b>硬拦截（4 次失败）之后怎么恢复？</b></summary>

硬拦截是故意的——它强制人工介入。删除 `state_dir` 下对应 session_id 的 `.json` 状态文件即可重置。
</details>

## 🤝 贡献

欢迎 PR。改规则、加平台支持、优化字段校验，都行。

## 📄 License

[MIT](LICENSE) — 随便用，记得也给你的 AI 套一个。🪢
