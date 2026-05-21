#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { callAuditor } = require('./llm-client.cjs');

/**
 * Universal AI Harness Main Kernel (V5.0)
 * 场景感知 · 中英双语 · 精准触发
 */

let inputData = '';
process.stdin.on('data', chunk => inputData += chunk);

function parseContext() {
  const stdinPayload = inputData.trim();
  if (stdinPayload) return JSON.parse(stdinPayload);
  const legacyArg = process.argv[2];
  if (legacyArg && legacyArg.trim().startsWith('{')) return JSON.parse(legacyArg);
  return null;
}

// ─── 场景检测器 ──────────────────────────────────────────────────────────────

/**
 * 场景分类：识别 agent 输出属于哪种"交付"类型
 * 返回 null 表示非交付场景（日常对话），直接放行
 */
function detectScenario(text) {
  // 先排除：明确的非交付场景
  if (isPassthrough(text)) return null;

  // 场景优先级：从具体到宽泛
  if (isFixScene(text)) return 'fix';
  if (isArchScene(text)) return 'arch';
  if (isCodeScene(text)) return 'code';
  if (isDesignScene(text)) return 'design';

  return null;
}

/**
 * 放行条件：这些情况不应触发审计
 */
function isPassthrough(text) {
  // 已自检
  if (/已自检/i.test(text)) return true;

  // 短回复（< 100 字符大概率是对话）
  if (text.length < 100) return true;

  // 纯问答/解释类（没有行动性内容）
  // 特征：没有代码块、没有有序列表、没有标题，只是一段文字
  const hasStructure = /^#{1,3}\s/m.test(text) || /^\d+\.\s/m.test(text) || /```/.test(text);
  if (!hasStructure && text.length < 500) return true;

  // 已完成报告（过去时态汇报，不是方案）
  const zhPastReport = /\d+\.\s*.{2,15}(了|完成|完毕)/m;
  const enPastReport = /\d+\.\s*(Fixed|Added|Removed|Updated|Refactored|Implemented|Created|Deleted|Configured|Resolved|Completed)\b/m;
  const pastLines = (text.match(zhPastReport) ? 1 : 0) + (text.match(enPastReport) ? 1 : 0);
  // 如果列表项大部分是过去时态，这是完成报告
  const totalListItems = (text.match(/^\d+\.\s/gm) || []).length;
  if (totalListItems >= 2 && pastLines > 0) return true;

  // 纯表格输出（信息展示，非方案）
  const tableLines = (text.match(/^\|.+\|$/gm) || []).length;
  if (tableLines >= 3 && !(/方案|plan|设计|design|实现|implement/i.test(text))) return true;

  // 明确的问句回复（agent 在回答用户问题）
  if (/^(是的|对|没错|不是|不对|Yes|No|Right|Correct|That's)/m.test(text) && text.length < 300) return true;

  return false;
}

/**
 * 修复场景：agent 在修 bug / 打补丁
 * 触发条件：修复类关键词 + 有代码或步骤
 */
function isFixScene(text) {
  const fixKeywords = /修复|修正|修改bug|fix(ed|ing|es)?(\s+the)?(\s+\w+)?\s+(bug|issue|error|problem)|patch|hotfix|workaround|临时方案|绕过/i;
  const hasAction = /```/.test(text) || /^\d+\.\s/m.test(text);
  return fixKeywords.test(text) && hasAction;
}

/**
 * 架构场景：agent 在做架构决策 / 重构
 * 触发条件：架构类关键词 + 结构化输出
 */
function isArchScene(text) {
  const archKeywords = /重构|架构|迁移|拆分|微服务|解耦|抽象|分层|refactor|architect|migrat|decouple|abstract|split.*(into|from)|extract|modular|layer/i;
  const hasStructure = /^#{1,3}\s/m.test(text) || /^\d+\.\s/m.test(text) || /```/.test(text);
  return archKeywords.test(text) && hasStructure;
}

/**
 * 代码实现场景：agent 在写代码交付
 * 触发条件：有代码块 + 代码量足够 + 有实现意图
 */
function isCodeScene(text) {
  const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
  if (codeBlocks.length === 0) return false;

  // 代码总行数
  const codeLines = codeBlocks.reduce((sum, block) => {
    return sum + block.split('\n').length - 2; // 减去 ``` 开头结尾
  }, 0);

  // 短代码片段（< 5 行）大概率是示例/解释，不触发
  if (codeLines < 5) return false;

  // 有实现意图的上下文
  const implIntent = /(实现|编写|创建|构建|implement|create|build|write|here'?s?\s+(the|my|a)\s+(code|implementation|solution)|如下|以下是|代码如下)/i;
  return implIntent.test(text);
}

/**
 * 方案设计场景：agent 在输出方案 / 计划 / 设计
 * 触发条件：方案类关键词 + 结构化 + 足够长度
 */
function isDesignScene(text) {
  const designKeywords = /(方案|设计|计划|思路|策略|步骤|流程|plan|design|approach|strategy|proposal|solution|roadmap|workflow)/i;
  if (!designKeywords.test(text)) return false;

  // 需要结构化（标题或有序列表）
  const hasHeader = /^#{1,3}\s/m.test(text);
  const hasList = /^\d+\.\s/m.test(text);
  if (!hasHeader && !hasList) return false;

  // 需要足够的内容量（方案通常较长）
  // 中文信息密度高，150 字符已足够；英文需要更多
  const minLen = /[\u4e00-\u9fff]/.test(text) ? 150 : 250;
  if (text.length < minLen) return false;

  // 有行动性动词（不只是描述）
  const actionVerbs = /(采用|引入|使用|部署|配置|建立|implement|introduce|deploy|configure|setup|integrate|adopt|leverage|utilize)/i;
  return actionVerbs.test(text);
}

// ─── 质询生成器 ──────────────────────────────────────────────────────────────

/**
 * 根据场景生成对应的质询内容（中英双语）
 * 设计原则：引导确认，而非暗示否定。给模型"确认无误"的合法出口。
 */
function generateChallenge(scenario, text) {
  // 检测回复语言倾向
  const isEnglish = detectLanguage(text) === 'en';

  const challenges = {
    fix: {
      zh: [
        "请确认：你是否已从第一性原理出发定位到问题的根源，而非仅在表象上打补丁？",
        "请确认：这个修改是否可能产生副作用？改动是否会影响到其他模块？"
      ],
      en: [
        "Please confirm: have you identified the root cause from first principles, rather than applying a surface-level patch?",
        "Please confirm: could this change produce side effects? Have you checked if it impacts other modules?"
      ]
    },
    arch: {
      zh: [
        "请确认：当前结构是否遵循了 KISS 原则？后期的可读性和可维护性是否有保障？",
        "请确认：是否考虑过关键的边界情况（并发、异常路径、权限边界）？"
      ],
      en: [
        "Please confirm: does this structure follow the KISS principle? Is long-term readability and maintainability ensured?",
        "Please confirm: have you considered critical edge cases (concurrency, error paths, permission boundaries)?"
      ]
    },
    code: {
      zh: [
        "请确认：你是否重新阅读了代码，检查过其中可能存在的逻辑冲突？",
        "请确认：实现是否遗漏了关键的边界情况（空值、异常路径）？修改是否可能影响已有功能？"
      ],
      en: [
        "Please confirm: have you re-read the code and checked for potential logical conflicts?",
        "Please confirm: are there missing edge cases (null values, error paths)? Could this change affect existing functionality?"
      ]
    },
    design: {
      zh: [
        "请确认：方案是否已深入分析并锁定了用户的核心诉求，而非解决了表面问题？",
        "请确认：你是否重新阅读了方案，检查过其中可能存在的逻辑冲突或遗漏？"
      ],
      en: [
        "Please confirm: does this proposal deeply address the user's core requirement, not just the surface problem?",
        "Please confirm: have you re-read the plan and checked for logical conflicts or gaps?"
      ]
    }
  };

  const lang = isEnglish ? 'en' : 'zh';
  const questions = challenges[scenario][lang];
  const ack = isEnglish
    ? 'If already considered, briefly confirm and reply "已自检". No need to change anything if the approach is sound.'
    : '如已考虑过上述问题，简要确认后回复"已自检"即可。方案正确无需修改。';

  return [...questions, ack].join('\n');
}

/**
 * 简单的语言检测：英文字符占比 > 60% 视为英文回复
 */
function detectLanguage(text) {
  // 去掉代码块再判断
  const noCode = text.replace(/```[\s\S]*?```/g, '');
  const ascii = noCode.replace(/[^a-zA-Z]/g, '').length;
  const total = noCode.replace(/\s/g, '').length;
  if (total === 0) return 'zh';
  return (ascii / total) > 0.6 ? 'en' : 'zh';
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

process.stdin.on('end', async () => {
  try {
    const ctx = parseContext();
    if (!ctx) return process.exit(0);

    // 1. 获取回复内容 & 递归保护
    const lastMsg = ctx.prompt_response || ctx.last_assistant_message || ctx.response || "";
    if (!lastMsg || ctx.stop_hook_active) return process.exit(0);

    // 2. 加载配置
    const skillConfigLocalPath = path.join(__dirname, '../harness.config.local.json');
    const skillConfigPath = path.join(__dirname, '../harness.config.json');
    const activeConfigPath = fs.existsSync(skillConfigLocalPath) ? skillConfigLocalPath : skillConfigPath;
    const rawConfig = fs.existsSync(activeConfigPath) ? JSON.parse(fs.readFileSync(activeConfigPath, 'utf8')) : {};
    const audit = rawConfig.audit || rawConfig;
    const mode = audit.mode || 'regex';
    const llmConfig = audit.llm_config || rawConfig.llm_config;

    // 3. 读取治理规则
    const rulesPath = path.join(__dirname, '../rules.md');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    // 4. LLM 模式
    if (mode === 'llm' && llmConfig) {
      try {
        const auditResult = await callAuditor(lastMsg, llmConfig, rules);
        if (auditResult.toUpperCase().includes('PASS')) {
          return process.exit(0);
        } else {
          console.log(JSON.stringify({ decision: "deny", reason: auditResult }));
        }
        return;
      } catch (e) {
        // LLM 失败降级至 regex
      }
    }

    // 5. Regex 模式：场景感知审计
    const scenario = detectScenario(lastMsg);
    if (!scenario) return process.exit(0); // 非交付场景，放行

    const challenge = generateChallenge(scenario, lastMsg);
    console.log(JSON.stringify({ decision: "deny", reason: challenge }));

  } catch (error) {
    process.exit(0);
  }
});

process.stdin.resume();
