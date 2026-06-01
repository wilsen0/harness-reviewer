#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { callAuditor } = require('./llm-client.cjs');
const state = require('./state.cjs');

const VERSION = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
  } catch (_) {
    return 'unknown';
  }
})();

// ─── Input parsing ────────────────────────────────────────────────────────────

let inputData = '';
process.stdin.on('data', chunk => inputData += chunk);

function parseContext() {
  const stdinPayload = inputData.trim();
  if (stdinPayload) {
    try { return JSON.parse(stdinPayload); } catch (_) {}
  }
  const legacyArg = process.argv[2];
  if (legacyArg && legacyArg.trim().startsWith('{')) {
    try { return JSON.parse(legacyArg); } catch (_) {}
  }
  return null;
}

function resolveSessionId(ctx) {
  if (!ctx) return null;
  if (typeof ctx.session_id === 'string' && ctx.session_id) return ctx.session_id;
  if (typeof ctx.thread_id === 'string' && ctx.thread_id) return ctx.thread_id;
  if (typeof ctx.conversation_id === 'string' && ctx.conversation_id) return ctx.conversation_id;
  return null;
}

function fallbackSessionId() {
  const ppid = process.ppid || '0';
  let h = 0;
  const s = process.cwd();
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const cwdHash = Math.abs(h).toString(36);
  return `pid-${ppid}-${cwdHash}`;
}

// ─── Config ──────────────────────────────────────────────────────────────────

function loadConfig() {
  const skillDir = path.resolve(__dirname, '..');
  const envPath = process.env.HARNESS_CONFIG;
  const localPath = path.join(skillDir, 'harness.config.local.json');
  const defaultPath = path.join(skillDir, 'harness.config.json');
  let activePath = defaultPath;
  if (envPath && fs.existsSync(envPath)) {
    activePath = envPath;
  } else if (fs.existsSync(localPath)) {
    activePath = localPath;
  }
  if (!fs.existsSync(activePath)) return { config: {}, activePath, skillDir };
  try {
    return { config: JSON.parse(fs.readFileSync(activePath, 'utf8')), activePath, skillDir };
  } catch (_) {
    return { config: {}, activePath, skillDir };
  }
}

// ─── Scenario detection ───────────────────────────────────────────────────────

function isFixScene(text) {
  const fixKeywords = /修复|修正|bug|fix(ed|ing)?\s+(the\s+)?(bug|issue|error|problem)|patch|hotfix|workaround|临时方案|绕过/i;
  const hasAction = /```/.test(text) || /^\d+\.\s/m.test(text) || /##\s*self[-\s]?review/i.test(text);
  return fixKeywords.test(text) && hasAction;
}

function isArchScene(text) {
  const archKeywords = /重构|架构|迁移|拆分|微服务|解耦|抽象|分层|refactor|architect|migrat|decouple|abstract|split\s+(into|from)|extract|modular|layer/i;
  const hasStructure = /^#{1,3}\s/m.test(text) || /^\d+\.\s/m.test(text) || /```/.test(text) || /##\s*self[-\s]?review/i.test(text);
  return archKeywords.test(text) && hasStructure;
}

function isCodeScene(text) {
  const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
  if (codeBlocks.length === 0) return false;
  const codeLines = codeBlocks.reduce((sum, block) => {
    return sum + Math.max(0, block.split('\n').length - 2);
  }, 0);
  if (codeLines < 2) return false;
  const implIntent = /(实现|编写|创建|构建|看下面|以下是|代码如下|改动|这里|这段|here'?s?\s+(the|my|a)\s+(code|implementation|solution)|implement|create|build|write)/i;
  return implIntent.test(text);
}

function isDesignScene(text) {
  const designKeywords = /(方案|设计|计划|思路|策略|步骤|流程|plan|design|approach|strategy|proposal|solution|roadmap|workflow)/i;
  if (!designKeywords.test(text)) return false;
  const hasHeader = /^#{1,3}\s/m.test(text);
  const hasList = /^\d+\.\s/m.test(text);
  if (!hasHeader && !hasList) return false;
  const minLen = /[一-龥]/.test(text) ? 50 : 200;
  if (text.length < minLen) return false;
  const actionVerbs = /(采用|引入|使用|部署|配置|建立|implement|introduce|deploy|configure|setup|integrate|adopt|leverage|utilize)/i;
  return actionVerbs.test(text);
}

function detectScenario(text) {
  if (isPassthrough(text)) return null;
  if (isFixScene(text)) return 'fix';
  if (isArchScene(text)) return 'arch';
  if (isCodeScene(text)) return 'code';
  if (isDesignScene(text)) return 'design';
  return null;
}

// ─── Passthrough tightening ───────────────────────────────────────────────────

function isPassthrough(text) {
  if (text.length < 50) return true;

  const hasStructure = /^#{1,3}\s/m.test(text) || /^\d+\.\s/m.test(text) || /```/.test(text);
  if (!hasStructure && text.length < 500) return true;

  // Past-tense report: ALL list items must start with a past-tense verb, AND a concrete verification claim must appear.
  const PAST_VERBS = '(?:fixed|added|removed|updated|refactored|implemented|created|deleted|configured|resolved|completed|修复|修改|删除|更新|实现|创建|部署|完成|解决|配置)';
  const pastItemRe = new RegExp(`(?:^|\\n)\\s*\\d+\\.\\s*${PAST_VERBS}`, 'gi');
  const pastItemCount = (text.match(pastItemRe) || []).length;
  const totalListItems = (text.match(/^\d+\.\s/gm) || []).length;
  if (totalListItems >= 2 && pastItemCount === totalListItems) {
    const concrete = new RegExp(
      '\\b(test|spec|build|npm|pnpm|yarn|cargo|go\\s+test|pytest|jest|vitest)\\b|测试通过|构建成功|编译通过|运行成功|^\\s*[+\\-]\\s|`[^`]+`',
      'm'
    );
    if (!concrete.test(text)) return false;
    return true;
  }

  const tableLines = (text.match(/^\|.+\|$/gm) || []).length;
  if (tableLines >= 3) {
    const hasDiff = /^\s*[+\-]\s/m.test(text) || /\.(ts|js|cjs|mjs|py|go|rs|java|swift)\b/.test(text);
    if (hasDiff) return false;
    if (!/(方案|plan|设计|design|实现|implement)/i.test(text)) return true;
  }

  if (/^(是的|对|没错|不是|不对|Yes|No|Right|Correct|That's)/m.test(text) && text.length < 300) return true;

  return false;
}

// ─── Self-review format spec ──────────────────────────────────────────────────

const FIELD_MATRIX = {
  fix: [
    { zh: '根因', en: 'root_cause' },
    { zh: '副作用范围', en: 'side_effects' },
    { zh: '边界情况', en: 'edge_cases' },
  ],
  arch: [
    { zh: 'KISS依据', en: 'kiss_basis' },
    { zh: '边界情况', en: 'edge_cases' },
    { zh: '与现有结构冲突', en: 'conflicts_with_existing' },
  ],
  code: [
    { zh: '逻辑冲突', en: 'logic_conflicts' },
    { zh: '边界情况', en: 'edge_cases' },
    { zh: '已有功能影响', en: 'existing_impact' },
  ],
  design: [
    { zh: '核心诉求', en: 'core_requirement' },
    { zh: '逻辑冲突', en: 'logic_conflicts' },
    { zh: '第一性原理依据', en: 'first_principles' },
  ],
};

function extractSelfReviewBlock(text) {
  const headerRe = /^#{2,3}\s*self[-\s]?review[ \t]*$/gim;
  const indices = [];
  let m;
  while ((m = headerRe.exec(text)) !== null) {
    indices.push(m.index);
  }
  if (indices.length === 0) return null;
  const start = indices[indices.length - 1];
  const after = text.slice(start);
  const eol = after.indexOf('\n');
  if (eol === -1) return '';
  let rest = after.slice(eol + 1);
  const nextHeader = rest.match(/^#{1,3}\s/m);
  if (nextHeader) {
    rest = rest.slice(0, nextHeader.index);
  }
  return rest;
}

function parseBulletFields(block) {
  const fields = {};
  if (!block) return fields;
  const re = /^[ \t]*[-*]\s+([^:：\n]+?)\s*[：:][ \t]*([^\n]*)/gm;
  let m;
  while ((m = re.exec(block)) !== null) {
    const name = m[1].trim();
    const content = m[2].trim();
    if (name) fields[name] = content;
  }
  return fields;
}

const CONCRETE_TOKEN_RE = new RegExp([
  String.raw`\/[\w.\/-]+\.(ts|js|cjs|mjs|py|go|rs|java|kt|swift|c|cpp|h|hpp|md|json|toml|yaml|yml|sh)\b`,
  String.raw`\`[^\`\n]+\``,
  String.raw`["'][^"'\n]{4,}["']`,
  String.raw`\b[a-zA-Z][a-zA-Z0-9_]*[A-Z_0-9][a-zA-Z0-9_]*\b`,
  String.raw`\b[A-Z][a-zA-Z0-9]{2,}\b`,
].join('|'), 'm');

function hasConcreteToken(content) {
  return CONCRETE_TOKEN_RE.test(content);
}

function validateSelfReview(text, scenario) {
  const block = extractSelfReviewBlock(text);
  if (!block) return { ok: false, reason: 'no-block', failedFields: ['缺少 ## Self-Review 段'] };
  const fields = parseBulletFields(block);
  const required = FIELD_MATRIX[scenario] || [];
  const failedFields = [];
  for (const { zh, en } of required) {
    const content = fields[zh] || fields[en] || '';
    if (!content) {
      failedFields.push(zh);
      continue;
    }
    if (content.length < 30) {
      failedFields.push(`${zh}(内容过短 ${content.length}<30)`);
      continue;
    }
    if (!hasConcreteToken(content)) {
      failedFields.push(`${zh}(缺具体凭证：文件路径/标识符/反引号符号/带引号引用)`);
    }
  }
  if (failedFields.length > 0) {
    return { ok: false, reason: 'invalid-fields', failedFields };
  }
  return { ok: true };
}

// ─── Challenge generation ─────────────────────────────────────────────────────

function formatFieldList(required) {
  return required.map(f => `- ${f.zh} | ${f.en}: <content>`).join('\n');
}

function generateChallenge(scenario, isEnglish, migrationMode, deniedFields) {
  const required = FIELD_MATRIX[scenario] || [];

  if (migrationMode) {
    return [
      '⚠️  Harness v1 → v2 migration notice',
      'The "已自检" magic word is no longer accepted. v2 requires a structured `## Self-Review` section.',
      '',
      '请在回复末尾添加如下段（中文或英文字段名任选其一）：',
      '',
      '## Self-Review',
      formatFieldList(required),
      '',
      '每条字段需要：长度 ≥ 30 字符 且 至少包含一个具体凭证（文件路径 / 标识符 / 反引号符号 / 带引号引用）。',
      '回复带上该段后，harness 会自动校验。',
    ].join('\n');
  }

  const questions = {
    fix: isEnglish
      ? 'Please confirm: have you identified the root cause from first principles, not just patched the surface?'
      : '请确认：你是否已从第一性原理定位到问题的根源，而非仅在表象上打补丁？',
    arch: isEnglish
      ? 'Please confirm: does this structure follow KISS? Have you considered concurrency, error paths, permission boundaries?'
      : '请确认：当前结构是否遵循 KISS 原则？是否考虑过并发、异常路径、权限边界？',
    code: isEnglish
      ? 'Please confirm: have you re-read for logical conflicts? Are there missing edge cases (null, error paths)? Could this affect existing functionality?'
      : '请确认：你是否重新阅读过代码，检查逻辑冲突？是否遗漏边界情况（空值、异常路径）？是否可能影响已有功能？',
    design: isEnglish
      ? 'Please confirm: does the proposal deeply address the user’s core requirement? Have you re-read for logical conflicts or gaps?'
      : '请确认：方案是否深入锁定用户核心诉求？你是否重新阅读过方案，检查逻辑冲突或遗漏？',
  }[scenario];

  const failedNote = (deniedFields && deniedFields.length > 0)
    ? `\n上一轮未通过的字段：${deniedFields.join('、')}。仅补齐这些字段即可，无需重写整段。`
    : '';

  return [
    questions,
    '',
    '请在回复末尾添加 `## Self-Review` 段，包含：',
    '',
    '## Self-Review',
    formatFieldList(required),
    '',
    '每条字段需要：长度 ≥ 30 字符 且 至少包含一个具体凭证（文件路径 / 标识符 / 反引号符号 / 带引号引用）。' + failedNote,
  ].join('\n');
}

// ─── Language detection ───────────────────────────────────────────────────────

function detectLanguage(text) {
  const noCode = text.replace(/```[\s\S]*?```/g, '');
  const ascii = noCode.replace(/[^a-zA-Z]/g, '').length;
  const total = noCode.replace(/\s/g, '').length;
  if (total === 0) return 'zh';
  return (ascii / total) > 0.6 ? 'en' : 'zh';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const ctx = parseContext();
  if (!ctx) return process.exit(0);

  const lastMsg = ctx.prompt_response || ctx.last_assistant_message || ctx.response || '';
  if (!lastMsg || ctx.stop_hook_active) return process.exit(0);

  const { config } = loadConfig();
  const audit = config.audit || {};
  const mode = audit.mode || 'regex';
  const dryRun = !!audit.dry_run || process.env.HARNESS_DRY_RUN === '1';
  const llmConfig = audit.llm_config;

  const stateDir = state.resolveStateDir(config);
  state.prune(stateDir);

  const sessionId = resolveSessionId(ctx) || fallbackSessionId();
  const { state: sess, filePath: stateFile } = state.loadOrCreate(stateDir, sessionId);

  let effectiveMode = sess.effective_mode || mode;
  let escalated = false;
  if (mode === 'regex' && state.shouldEscalate(sess) && llmConfig) {
    effectiveMode = 'llm';
    sess.effective_mode = 'llm';
    escalated = true;
  }

  if (state.shouldHardBlock(sess)) {
    const stateDirForRecovery = state.resolveStateDir(config);
    const reason = `需要人工确认：本会话已累计 4 次拦截，自动升级到人工审核。请联系 reviewer 人工放行，或删除 ${stateDirForRecovery}/${sessionId}.json 重置计数。`;
    state.save(stateFile, sess);
    if (dryRun) {
      process.stderr.write(JSON.stringify({ decision: 'deny', reason, scenario: null, hard_block: true, deny_count: sess.deny_count }) + '\n');
      return process.exit(0);
    }
    console.log(JSON.stringify({ decision: 'deny', reason }));
    return process.exit(0);
  }

  const scenario = detectScenario(lastMsg);

  if (!scenario) {
    state.recordPass(sess, null);
    state.save(stateFile, sess);
    if (dryRun) {
      process.stderr.write(JSON.stringify({ decision: 'pass', reason: 'passthrough', scenario: null }) + '\n');
    }
    return process.exit(0);
  }

  const isEnglish = detectLanguage(lastMsg) === 'en';

  if (effectiveMode === 'llm') {
    if (!llmConfig) {
      const reason = 'LLM 审计不可用：未配置 llm_config，无法启用升级模式。请在 harness.config.json 补全 audit.llm_config 或暂时切换回 regex 模式。';
      state.recordDeny(sess, scenario, ['(llm_config missing)']);
      state.save(stateFile, sess);
      if (dryRun) {
        process.stderr.write(JSON.stringify({ decision: 'deny', reason, scenario, effective_mode: 'llm', error: 'no_llm_config', escalated }) + '\n');
        return process.exit(0);
      }
      console.log(JSON.stringify({ decision: 'deny', reason }));
      return process.exit(0);
    }
    try {
      const rulesPath = path.join(__dirname, '..', 'rules.md');
      const rules = fs.readFileSync(rulesPath, 'utf8');
      const auditResult = await callAuditor(lastMsg, llmConfig, rules);
      const passed = /\bPASS\b/i.test(auditResult);
      if (passed) {
        state.recordPass(sess, scenario);
        state.save(stateFile, sess);
        if (dryRun) {
          process.stderr.write(JSON.stringify({ decision: 'pass', reason: 'llm', scenario, escalated }) + '\n');
        }
        return process.exit(0);
      }
      state.recordDeny(sess, scenario, ['(llm-judged)']);
      state.save(stateFile, sess);
      if (dryRun) {
        process.stderr.write(JSON.stringify({ decision: 'deny', reason: auditResult, scenario, escalated }) + '\n');
        return process.exit(0);
      }
      console.log(JSON.stringify({ decision: 'deny', reason: auditResult }));
      return process.exit(0);
    } catch (e) {
      const reason = `LLM 审计不可用：${e.message || e}。请检查 llm_config 或切换至 regex 模式。`;
      state.recordDeny(sess, scenario, ['(llm-error)']);
      state.save(stateFile, sess);
      if (dryRun) {
        process.stderr.write(JSON.stringify({ decision: 'deny', reason, scenario, error: 'llm_failure', escalated }) + '\n');
        return process.exit(0);
      }
      process.stderr.write(`[harness] ${reason}\n`);
      console.log(JSON.stringify({ decision: 'deny', reason }));
      return process.exit(0);
    }
  }

  // regex mode
  const validation = validateSelfReview(lastMsg, scenario);
  const containsV1Magic = /已自检/i.test(lastMsg);
  const isMigration = containsV1Magic && !validation.ok && validation.reason === 'no-block' && !sess.v1_magic_word_seen;

  if (validation.ok) {
    state.recordPass(sess, scenario);
    state.save(stateFile, sess);
    if (dryRun) {
      process.stderr.write(JSON.stringify({ decision: 'pass', reason: 'self-review-valid', scenario, escalated }) + '\n');
    }
    return process.exit(0);
  }

  state.recordDeny(sess, scenario, validation.failedFields);
  if (isMigration) sess.v1_magic_word_seen = true;
  state.save(stateFile, sess);

  const challenge = isMigration
    ? generateChallenge(scenario, isEnglish, true, null)
    : generateChallenge(scenario, isEnglish, false, validation.failedFields);

  if (dryRun) {
    process.stderr.write(JSON.stringify({
      decision: 'deny',
      reason: challenge,
      scenario,
      failed_fields: validation.failedFields,
      migration: isMigration,
      deny_count: sess.deny_count,
      escalated,
    }) + '\n');
    return process.exit(0);
  }

  console.log(JSON.stringify({ decision: 'deny', reason: challenge }));
  process.exit(0);
}

process.stdin.on('end', () => {
  main().catch((e) => {
    process.stderr.write(`[harness] unhandled error: ${e && e.message || e}\n`);
    process.exit(0);
  });
});

process.stdin.resume();
