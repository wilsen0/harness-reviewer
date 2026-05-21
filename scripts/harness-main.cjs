#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { callAuditor } = require('./llm-client.cjs');

const REVIEW_ACK_REGEX = /已自检/i;

/**
 * Universal AI Harness Main Kernel (V4.0)
 * 极简、自适应、闭环。
 */

let inputData = '';
process.stdin.on('data', chunk => inputData += chunk);

function parseContext() {
  const stdinPayload = inputData.trim();
  if (stdinPayload) {
    return JSON.parse(stdinPayload);
  }

  const legacyArg = process.argv[2];
  if (legacyArg && legacyArg.trim().startsWith('{')) {
    return JSON.parse(legacyArg);
  }

  return null;
}

process.stdin.on('end', async () => {
  try {
    const ctx = parseContext();
    if (!ctx) return process.exit(0);
    
    // 1. 自适应获取回复内容与递归保护
    const lastMsg = ctx.prompt_response || ctx.last_assistant_message || ctx.response || "";
    if (!lastMsg || ctx.stop_hook_active) return process.exit(0);

    // 2. 环境自适应配置加载
    const projectRoot = process.cwd();
    let configPath = path.join(projectRoot, '.gemini', 'harness-config.json');
    if (!fs.existsSync(configPath)) configPath = path.join(projectRoot, '.claude', 'harness-config.json');
    if (!fs.existsSync(configPath)) configPath = path.join(projectRoot, '.codex', 'harness-config.json');
    if (!fs.existsSync(configPath)) configPath = path.join(os.homedir(), '.codex', 'harness-config.json');

    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { mode: 'regex' };
    
    // 3. 读取治理宪法 (KISS: 规则与代码分离)
    const rulesPath = path.join(__dirname, '../rules.md');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    // 4. 执行审计
    if (config.mode === 'llm') {
      try {
        const auditResult = await callAuditor(lastMsg, config.llm_config, rules);
        if (auditResult.toUpperCase().includes('PASS')) {
          return process.exit(0);
        } else {
          // 拦截并注入判官提问
          console.log(JSON.stringify({ decision: "block", reason: auditResult }));
        }
        return;
      } catch (e) {
        // LLM 失败降级至正则
      }
    }

    // 5. 多信号打分兜底 (V4.3)
    if (REVIEW_ACK_REGEX.test(lastMsg)) return process.exit(0);

    let score = 0;
    // 结构信号（各+1，上限3）
    const hasHeader = /^#{1,3}\s/m.test(lastMsg);
    const hasList = /^\d+\.\s/m.test(lastMsg);
    const hasCode = /```/.test(lastMsg);
    if (hasHeader) score++;
    if (hasList) score++;
    if (hasCode) score++;
    // 意图信号：名词（+1）+ 动作动词（+1）
    const intent = /(方案|设计|计划|实现|重构|架构|修复|步骤|思路|部署|迁移)/i.exec(lastMsg);
    if (intent) score++;
    const hasVerb = /(采用|引入|拆分|添加|移除|替换|构建|修改|更改|优化|编写|创建|删除|配置|使用|设置|建立)/i.test(lastMsg);
    if (hasVerb) score++;
    // 长度信号（+1）
    if (lastMsg.length > 150) score++;
    // 负信号：报告/表格格式（-2）
    if (/\|.*\|.*\|/.test(lastMsg)) score -= 2;
    // 负信号：过去时态列表项"1. 修复了..."表示已完成报告（-2）
    if (/\d+\.\s.*了/m.test(lastMsg)) score -= 2;

    if (score >= 4) {
      // 根据意图关键词匹配针对性质询
      const Q = {
        fix: "这是否属于'补丁思维'？你真的找到问题的根源了吗？",
        design: "在交付之前，你是否重新阅读并检查过其中可能存在的逻辑冲突？",
        arch: "你如何证明当前的结构已严格遵循 KISS 原则，而非在堆砌复杂逻辑？",
      };
      const kw = intent ? intent[1] : '';
      let q1, q2;
      if (/修复|补丁/.test(kw)) {
        q1 = Q.fix; q2 = Q.design;
      } else if (/重构|架构|迁移/.test(kw)) {
        q1 = Q.arch; q2 = Q.design;
      } else if (/方案|设计|计划|思路/.test(kw)) {
        q1 = Q.design; q2 = Q.arch;
      } else {
        q1 = Q.design; q2 = Q.fix;
      }
      // 代码实现类优先提示 KISS
      if (hasCode) { q1 = Q.arch; q2 = Q.design; }

      const reviewPrompt = [
        q1,
        q2,
        `请在反思后以"已自检"确认放行。`
      ].join('\n');
      console.log(JSON.stringify({ decision: "block", reason: reviewPrompt }));
    } else {
      process.exit(0);
    }

  } catch (error) {
    process.exit(0);
  }
});

process.stdin.resume();
