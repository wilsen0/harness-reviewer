#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const HARNESS = path.join(__dirname, 'harness-main.cjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));

function writeConfig(audit) {
  const config = {
    version: 2,
    platforms: { gemini: { enabled: false }, claude: { enabled: false }, codex: { enabled: false } },
    state_dir: path.join(TMP, 'state'),
    audit: { mode: 'regex', dry_run: true, ...audit },
    kiro: { auto_configure: false },
  };
  const configPath = path.join(TMP, 'harness.config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function runHarness(input, configPath) {
  const result = spawnSync('node', [HARNESS], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_DRY_RUN: '1', HARNESS_CONFIG: configPath },
  });
  const stderr = result.stderr || '';
  const stdout = result.stdout || '';
  let parsed = null;
  const stream = stderr.includes('"decision"') ? stderr : stdout;
  for (const line of stream.split('\n')) {
    if (!line.trim()) continue;
    try { parsed = JSON.parse(line); } catch (_) {}
  }
  return { code: result.statusCode, parsed, stderr, stdout, input };
}

const FIXTURE_MSGS = {
  fix_no_review: '我修复了 auth 模块的 token 过期判断问题，下面是改动：\n\n1. 查看 src/auth/session.ts 找到过期判断逻辑\n2. 增加了 clock skew 容忍度\n3. 更新了相关测试用例',
  fix_valid_review: '我修复了 auth 模块的 token 过期判断问题。\n\n## Self-Review\n- 根因: 查看 `src/auth/session.ts` 第 42 行的 token 解码逻辑，问题是没有考虑 `clockSkew`，跨时区会误判。\n- 副作用范围: 仅影响 `SessionManager.refresh` 调用方，grep -r refresh 已确认无其他引用。\n- 边界情况: 已考虑 `nullToken`、`revokedToken`、`crossTimezone` 三种情况。',
  fix_short_review: '修复完成。\n\n## Self-Review\n- 根因: 已修复\n- 副作用范围: 无\n- 边界情况: 已考虑',
  fix_missing_field: '我修复了 token 过期问题，下面是说明：\n\n## Self-Review\n- 根因: 通过查看 src/auth/session.ts 第 42 行定位到 token 过期检查问题。\n- 副作用范围: 仅影响 SessionManager.refresh 调用方，已确认无其他引用。',
  fix_no_concrete: '我修复了一个 bug，下面是说明：\n\n## Self-Review\n- 根因: 看到问题后觉得应该改一下，于是就改了。\n- 副作用范围: 看了看周围好像没什么影响。\n- 边界情况: 应该还好吧。',
  arch_no_review: '我准备重构 user 模块以支持多租户场景，下面是方案：\n\n## 目标\n1. 拆分 service 层为 per-tenant 实例\n2. 引入 tenantId 抽象\n3. 部署到生产',
  arch_valid_review: '我重构了 user 模块以支持多租户场景。\n\n## Self-Review\n- KISS依据: 原本 5 层抽象降到 3 层，`serviceLayer` 的 `interface` 字段多余，删掉以减少间接性。\n- 边界情况: 已考虑并发（用 `RWMutex` 而非全局锁）、错误传播（`Result` 类型兜底）、权限边界（`middleware` 拦截）。\n- 与现有结构冲突: 检查了 `controller` 层和 `middleware` 依赖，没有循环引用。',
  code_no_review: '下面是 user 模块的改动：\n\n```js\nfunction createUser(data) {\n  return db.insert(\'users\', data);\n}\n\nfunction updateUser(id, data) {\n  return db.update(\'users\', id, data);\n}\n```\n\n这段代码实现了新的 CRUD 逻辑。',
  code_valid_review: '下面是 user 模块的改动：\n\n```js\nfunction createUser(data) {\n  return db.insert(\'users\', data);\n}\n```\n\n## Self-Review\n- 逻辑冲突: 重新阅读了 `createUser` 函数和 `db.insert` 的实现，没有发现逻辑冲突。\n- 边界情况: 已考虑 `nullInput`、`emptyObject`、`oversizedField`、`typeMismatch` 四种边界情况。\n- 已有功能影响: 用 grep 确认现有调用方只有 `test/user.spec.ts` 一处。',
  design_no_review: '## 缓存层方案\n\n1. 引入 Redis 作为缓存层降低数据库压力\n2. 配置连接池和 TTL 策略处理过期\n3. 部署到生产环境，监控命中率指标',
  design_valid_review: '## 缓存层方案\n\n1. 引入 Redis 作为缓存层降低数据库压力\n2. 配置连接池和 TTL 策略处理过期\n3. 部署到生产环境，监控命中率指标\n\n## Self-Review\n- 核心诉求: 用户的诉求是降低数据库压力，`cacheHitRate` 提升是核心指标，不是简单上 Redis。\n- 逻辑冲突: 重新阅读方案，缓存失效策略与现有 `cronTask` 没有重叠，`sessionWrite` 路径独立。\n- 第一性原理依据: 从延迟分布来看 `p99Latency` 在 DB 上，缓存能直接解决，不要为了泛化而泛化。',
  // v1_migration: must be (a) ≥ 50 chars to clear the short-message passthrough gate,
  // (b) have structure (numbered list) to clear the "no structure + < 500 chars" passthrough,
  // (c) include "已自检" magic word, (d) NOT have a valid ## Self-Review block.
  // Item 3 is short and lacks a past-tense verb, so the past-tense passthrough gate doesn't fire.
  v1_migration: '我修复了 token 过期的 bug，下面是详细的改动说明、改动文件清单和测试结果摘要，请查看具体改动。\n\n1. 修改了 `src/auth/session.ts` 的过期判断逻辑\n2. 更新了相关测试用例\n3. 已自检。',
};

const FIXTURES = [
  {
    name: 'passthrough: short acknowledgment',
    input: { session_id: 't-passthru-short', last_assistant_message: '是的。' },
    expect: { decision: 'pass' },
  },
  {
    name: 'passthrough: short English Q&A',
    input: { session_id: 't-passthru-qa', last_assistant_message: "Yes, that's correct." },
    expect: { decision: 'pass' },
  },
  {
    name: 'fix: no self-review → deny',
    input: { session_id: 't-fix-deny', last_assistant_message: FIXTURE_MSGS.fix_no_review },
    expect: { decision: 'deny', scenario: 'fix', migration: false },
  },
  {
    name: 'fix: valid self-review → pass',
    input: { session_id: 't-fix-pass', last_assistant_message: FIXTURE_MSGS.fix_valid_review },
    expect: { decision: 'pass', scenario: 'fix' },
  },
  {
    name: 'fix: self-review content too short → deny',
    input: { session_id: 't-fix-short', last_assistant_message: FIXTURE_MSGS.fix_short_review },
    expect: { decision: 'deny', scenario: 'fix' },
  },
  {
    name: 'fix: self-review missing field → deny',
    input: { session_id: 't-fix-missing', last_assistant_message: FIXTURE_MSGS.fix_missing_field },
    expect: { decision: 'deny', scenario: 'fix' },
  },
  {
    name: 'fix: self-review field has no concrete token → deny',
    input: { session_id: 't-fix-no-concrete', last_assistant_message: FIXTURE_MSGS.fix_no_concrete },
    expect: { decision: 'deny', scenario: 'fix' },
  },
  {
    name: 'arch: no self-review → deny',
    input: { session_id: 't-arch-deny', last_assistant_message: FIXTURE_MSGS.arch_no_review },
    expect: { decision: 'deny', scenario: 'arch' },
  },
  {
    name: 'arch: valid self-review → pass',
    input: { session_id: 't-arch-pass', last_assistant_message: FIXTURE_MSGS.arch_valid_review },
    expect: { decision: 'pass', scenario: 'arch' },
  },
  {
    name: 'code: code block triggers scenario',
    input: { session_id: 't-code-deny', last_assistant_message: FIXTURE_MSGS.code_no_review },
    expect: { decision: 'deny', scenario: 'code' },
  },
  {
    name: 'code: with self-review → pass',
    input: { session_id: 't-code-pass', last_assistant_message: FIXTURE_MSGS.code_valid_review },
    expect: { decision: 'pass', scenario: 'code' },
  },
  {
    name: 'design: triggers scenario',
    input: { session_id: 't-design-deny', last_assistant_message: FIXTURE_MSGS.design_no_review },
    expect: { decision: 'deny', scenario: 'design' },
  },
  {
    name: 'design: with self-review → pass',
    input: { session_id: 't-design-pass', last_assistant_message: FIXTURE_MSGS.design_valid_review },
    expect: { decision: 'pass', scenario: 'design' },
  },
  {
    name: 'v1 migration: magic word + no Self-Review → migration message',
    input: { session_id: 't-migration', last_assistant_message: FIXTURE_MSGS.v1_migration },
    expect: { decision: 'deny', scenario: 'fix', migration: true },
  },
  {
    name: 'v1 migration: short magic-word message (too short to audit)',
    input: { session_id: 't-migration-2', last_assistant_message: '已自检。' },
    expect: { decision: 'pass' },
  },
];

// Multi-step fixtures
const MULTI_STEPS = [
  {
    name: 'escalation: 2 denies → 3rd call flips to LLM, fail-closed with empty api_key',
    audit: {
      mode: 'regex',
      llm_config: { provider: 'openai', model: 'x', api_key: '', endpoint: 'https://invalid.example.com/v1' },
    },
    steps: [
      { input: { session_id: 't-escalate', last_assistant_message: FIXTURE_MSGS.fix_no_review }, expect: { decision: 'deny', scenario: 'fix' } },
      { input: { session_id: 't-escalate', last_assistant_message: FIXTURE_MSGS.fix_no_review }, expect: { decision: 'deny', scenario: 'fix' } },
      { input: { session_id: 't-escalate', last_assistant_message: FIXTURE_MSGS.fix_no_review }, expect: { decision: 'deny', scenario: 'fix', escalated: true } },
    ],
  },
  {
    name: 'hard block: 4 denies → 5th call hard-blocks',
    audit: { mode: 'regex' },
    steps: [
      { input: { session_id: 't-hardblock', last_assistant_message: FIXTURE_MSGS.fix_no_review }, expect: { decision: 'deny', scenario: 'fix' } },
      { input: { session_id: 't-hardblock', last_assistant_message: FIXTURE_MSGS.fix_no_review }, expect: { decision: 'deny', scenario: 'fix' } },
      { input: { session_id: 't-hardblock', last_assistant_message: FIXTURE_MSGS.fix_no_review }, expect: { decision: 'deny', scenario: 'fix' } },
      { input: { session_id: 't-hardblock', last_assistant_message: FIXTURE_MSGS.fix_no_review }, expect: { decision: 'deny', scenario: 'fix' } },
      { input: { session_id: 't-hardblock', last_assistant_message: FIXTURE_MSGS.fix_no_review }, expect: { hard_block: true } },
    ],
  },
  {
    name: 'consecutive_passes: 3 passes reset deny_count',
    audit: { mode: 'regex' },
    steps: [
      { input: { session_id: 't-reset', last_assistant_message: FIXTURE_MSGS.fix_no_review }, expect: { decision: 'deny', scenario: 'fix' } },
      { input: { session_id: 't-reset', last_assistant_message: '是的。' }, expect: { decision: 'pass' } },
      { input: { session_id: 't-reset', last_assistant_message: '是的。' }, expect: { decision: 'pass' } },
      { input: { session_id: 't-reset', last_assistant_message: '是的。' }, expect: { decision: 'pass' } },
    ],
  },
];

function compare(name, got, exp) {
  if (!got.parsed) {
    return { ok: false, msg: `no JSON output from harness (likely crashed). stderr: ${(got.stderr || '').slice(0, 500)}` };
  }
  if (exp.decision !== undefined && got.parsed.decision !== exp.decision) return { ok: false, msg: `decision expected ${exp.decision} got ${got.parsed.decision}` };
  if (exp.scenario !== undefined && got.parsed.scenario !== exp.scenario) return { ok: false, msg: `scenario expected ${exp.scenario} got ${got.parsed.scenario}` };
  if (exp.migration !== undefined && got.parsed.migration !== exp.migration) return { ok: false, msg: `migration expected ${exp.migration} got ${got.parsed.migration}` };
  if (exp.escalated !== undefined && got.parsed.escalated !== exp.escalated) return { ok: false, msg: `escalated expected ${exp.escalated} got ${got.parsed.escalated}` };
  if (exp.hard_block === true) {
    if (got.parsed.hard_block !== true) return { ok: false, msg: `expected hard_block=true, got ${JSON.stringify(got.parsed)}` };
  }
  return { ok: true };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

console.log(`\n🧪 Harness Test Runner (v2)\n`);

// Single-step fixtures
const singleConfigPath = writeConfig({});
console.log('Single-step fixtures:');
for (const fixture of FIXTURES) {
  const got = runHarness(fixture.input, singleConfigPath);
  const cmp = compare(fixture.name, got, fixture.expect);
  if (cmp.ok) {
    console.log(`  ✅ ${fixture.name}`);
    passed += 1;
  } else {
    console.log(`  ❌ ${fixture.name}`);
    console.log(`     ${cmp.msg}`);
    console.log(`     stderr: ${(got.stderr || '').slice(0, 300)}`);
    failed += 1;
    failures.push(fixture.name);
  }
}

// Multi-step fixtures
console.log('\nMulti-step fixtures:');
for (const ms of MULTI_STEPS) {
  const configPath = writeConfig(ms.audit || {});
  for (let i = 0; i < ms.steps.length; i += 1) {
    const step = ms.steps[i];
    const got = runHarness(step.input, configPath);
    const cmp = compare(`${ms.name} [step ${i + 1}]`, got, step.expect);
    if (cmp.ok) {
      console.log(`  ✅ ${ms.name} [step ${i + 1}]`);
      passed += 1;
    } else {
      console.log(`  ❌ ${ms.name} [step ${i + 1}]`);
      console.log(`     ${cmp.msg}`);
      console.log(`     stderr: ${(got.stderr || '').slice(0, 300)}`);
      failed += 1;
      failures.push(`${ms.name} [step ${i + 1}]`);
    }
  }
}

// Cleanup
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
