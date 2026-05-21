#!/usr/bin/env node

/**
 * Harness Status Checker
 * Shows which platforms are configured and whether hooks are actually installed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const skillDir = path.resolve(__dirname, '..');
const configLocalPath = path.join(skillDir, 'harness.config.local.json');
const configDefaultPath = path.join(skillDir, 'harness.config.json');
const configPath = fs.existsSync(configLocalPath) ? configLocalPath : configDefaultPath;
const mainKernelPath = path.join(skillDir, 'scripts', 'harness-main.cjs');
const harnessCommand = `node ${mainKernelPath}`;

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function checkGeminiHook(scope) {
  const paths = [];
  if (scope === 'global') {
    paths.push(path.join(os.homedir(), '.gemini', 'settings.json'));
  } else {
    paths.push(path.join(process.cwd(), '.gemini', 'settings.json'));
  }

  for (const p of paths) {
    const settings = readJson(p);
    if (!settings || !settings.hooks || !settings.hooks.AfterAgent) continue;
    const found = settings.hooks.AfterAgent.some(g =>
      g.hooks && g.hooks.some(h => h.command && h.command.includes('harness-main'))
    );
    if (found) return { installed: true, path: p };
  }
  return { installed: false, path: paths[0] };
}

function checkClaudeHook(scope) {
  const paths = [];
  if (scope === 'global') {
    paths.push(path.join(os.homedir(), '.claude', 'settings.json'));
  } else {
    paths.push(path.join(process.cwd(), '.claude', 'settings.json'));
  }

  for (const p of paths) {
    const settings = readJson(p);
    if (!settings || !settings.hooks || !settings.hooks.Stop) continue;
    const found = settings.hooks.Stop.some(g =>
      g.hooks && g.hooks.some(h => h.command && h.command.includes('harness-main'))
    );
    if (found) return { installed: true, path: p };
  }
  return { installed: false, path: paths[0] };
}

function checkCodexHook() {
  const hooksPath = path.join(os.homedir(), '.codex', 'hooks.json');
  const hooksConfig = readJson(hooksPath);
  if (!hooksConfig || !hooksConfig.hooks || !hooksConfig.hooks.Stop) {
    return { installed: false, path: hooksPath };
  }
  const found = hooksConfig.hooks.Stop.some(g =>
    g.hooks && g.hooks.some(h => h.command && h.command.includes('harness-main'))
  );
  return { installed: found, path: hooksPath };
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`\n🔍 Harness Status Report`);
console.log(`${'─'.repeat(60)}`);

// Config
if (!fs.existsSync(configPath)) {
  console.log(`\n❌ Config not found: ${configPath}`);
  process.exit(1);
}

const config = readJson(configPath);
const platforms = config.platforms || {};
const audit = config.audit || {};

console.log(`\n⚙️  Config: ${configPath}`);
console.log(`   Audit mode: ${audit.mode || 'regex'}`);
if (audit.mode === 'llm' && audit.llm_config) {
  console.log(`   LLM provider: ${audit.llm_config.provider || '?'}`);
  console.log(`   LLM model: ${audit.llm_config.model || '?'}`);
  const hasKey = audit.llm_config.api_key && !audit.llm_config.api_key.includes('...');
  console.log(`   API key: ${hasKey ? '✅ configured' : '⚠️  placeholder (not set)'}`);
}

console.log(`\n📡 Platform Status:`);
console.log(`${'─'.repeat(60)}`);

// Gemini
const geminiConfig = platforms.gemini || { enabled: false };
const geminiCheck = checkGeminiHook(geminiConfig.scope || 'project');
const geminiEnabled = geminiConfig.enabled ? '✅ enabled' : '⬚ disabled';
const geminiInstalled = geminiCheck.installed ? '✅ hook found' : '❌ hook missing';
console.log(`\n   Gemini CLI`);
console.log(`     Config:    ${geminiEnabled}`);
console.log(`     Installed: ${geminiInstalled}`);
console.log(`     Scope:     ${geminiConfig.scope || 'project'}`);
console.log(`     Hook file: ${geminiCheck.path}`);

// Claude
const claudeConfig = platforms.claude || { enabled: false };
const claudeCheck = checkClaudeHook(claudeConfig.scope || 'project');
const claudeEnabled = claudeConfig.enabled ? '✅ enabled' : '⬚ disabled';
const claudeInstalled = claudeCheck.installed ? '✅ hook found' : '❌ hook missing';
console.log(`\n   Claude Code`);
console.log(`     Config:    ${claudeEnabled}`);
console.log(`     Installed: ${claudeInstalled}`);
console.log(`     Scope:     ${claudeConfig.scope || 'project'}`);
console.log(`     Hook file: ${claudeCheck.path}`);

// Codex
const codexConfig = platforms.codex || { enabled: false };
const codexCheck = checkCodexHook();
const codexEnabled = codexConfig.enabled ? '✅ enabled' : '⬚ disabled';
const codexInstalled = codexCheck.installed ? '✅ hook found' : '❌ hook missing';
console.log(`\n   Codex CLI`);
console.log(`     Config:    ${codexEnabled}`);
console.log(`     Installed: ${codexInstalled}`);
console.log(`     Scope:     global (Codex only supports global hooks)`);
console.log(`     Hook file: ${codexCheck.path}`);

// Summary
console.log(`\n${'─'.repeat(60)}`);
const mismatches = [];
if (geminiConfig.enabled && !geminiCheck.installed) mismatches.push('Gemini');
if (claudeConfig.enabled && !claudeCheck.installed) mismatches.push('Claude');
if (codexConfig.enabled && !codexCheck.installed) mismatches.push('Codex');

if (mismatches.length > 0) {
  console.log(`\n⚠️  ${mismatches.join(', ')} enabled in config but hook not installed.`);
  console.log(`   Run: node ${path.join(skillDir, 'scripts', 'install.cjs')}`);
} else {
  console.log(`\n✅ All enabled platforms have hooks installed.`);
}
console.log('');
