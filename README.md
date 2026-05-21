# 🎭 Harness Reviewer — 给你的 AI 套上"紧箍咒"

> 你的 AI 助手太听话了？写代码从不三思？方案交了就跑？
>
> 是时候请一位**铁面判官**来管管它了。

## 这是什么？

Harness Reviewer 是一个跨平台的 AI 行为治理系统。它像一个安静坐在旁边的代码审查员——每当你的 AI 助手（Gemini / Claude / Codex）准备交付方案时，判官会跳出来灵魂拷问：

- 🤔 "你真的找到问题根源了吗？还是在贴创可贴？"
- 🧐 "交卷之前，你重新检查过逻辑冲突没？"
- 🪞 "这玩意儿符合 KISS 原则吗？还是在炫技？"

只有 AI 老老实实做完自我反思，判官才会放行。

## 工作原理

```
AI 输出方案 → 判官拦截 → 灵魂质询 → AI 自我反思 → 判官放行 ✅
                                    ↑
                              不合格？打回重来 🔄
```

两种审计模式：

| 模式 | 特点 | 适合场景 |
|------|------|----------|
| `regex` (默认) | 零延迟，本地正则打分 | 日常开发，不想花钱 |
| `llm` | 调用外部 LLM 深度语义审计 | 重要项目，需要严格把关 |

## 快速开始

### 1. 安装

把这个目录放到你的项目中，然后运行：

```bash
node scripts/install.cjs
```

安装脚本会自动检测你用的 AI 工具（Gemini / Claude / Codex），并注册对应的 hook。

### 2. 配置 LLM 模式（可选）

如果你想启用更智能的语义审计：

```bash
# 复制模板
cp scripts/harness-config.example.json .gemini/harness-config.json
# 或者
cp scripts/harness-config.example.json .claude/harness-config.json
```

然后编辑配置，填入你自己的 API Key：

```json
{
  "mode": "llm",
  "llm_config": {
    "provider": "openai",
    "model": "qwen/qwen3.6-plus-preview:free",
    "api_key": "你的真实 key",
    "endpoint": "https://openrouter.ai/api/v1/chat/completions"
  }
}
```

支持 OpenRouter、OpenAI、Ollama 等兼容 OpenAI 格式的服务。

### 3. 自定义规则

所有治理规则集中在 `rules.md` 一个文件里。想让判官更严厉或更温柔？直接改它就行，即时生效，无需重新安装。

## 项目结构

```
harness-reviewer/
├── README.md              ← 你在这里
├── rules.md               ← 治理宪法（判官的行为准则）
├── SKILL.md               ← 技能元数据
├── .gitignore             ← 防止 API Key 泄露
└── scripts/
    ├── harness-main.cjs   ← 核心引擎（拦截 + 打分 + 质询）
    ├── llm-client.cjs     ← LLM 调用客户端
    ├── install.cjs         ← 一键安装脚本
    └── harness-config.example.json  ← 配置模板
```

## 支持的平台

- ✅ Gemini CLI（`.gemini/settings.json`）
- ✅ Claude Code（`.claude/settings.json`）
- ✅ Codex CLI（`~/.codex/hooks.json`）
- ✅ Kiro（自动配置 Codex CLI 路径）

## FAQ

**Q: AI 被拦截后怎么办？**

A: AI 需要根据质询进行自我反思，然后回复"已自检"即可放行。

**Q: 我不想用 LLM 模式，会花钱吗？**

A: 默认 `regex` 模式纯本地运行，零成本零延迟。

**Q: 规则改了需要重新安装吗？**

A: 不需要。hook 直接引用源文件，改完即生效。

**Q: 判官会不会太烦了？**

A: 只有当 AI 输出"像是在交付方案"时才会触发。日常闲聊不会被拦截。

## 许可

随便用，记得给你的 AI 也套一个。🎭
