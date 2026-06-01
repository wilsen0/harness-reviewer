#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const skillDir = path.resolve(__dirname, '..');
const mainKernelPath = path.join(skillDir, 'scripts', 'harness-main.cjs');
const cwd = process.cwd();

const VERSION = (() => {
  try {
    return fs.readFileSync(path.join(skillDir, 'VERSION'), 'utf8').trim();
  } catch (_) {
    return 'unknown';
  }
})();

console.log(`🚀 Starting Harness Installation (v${VERSION})...`);
console.log(`📍 Skill Source: ${skillDir}`);

// Hardcoded hook events per platform (single source of truth)
const PLATFORM_EVENTS = {
  gemini: 'AfterAgent',
  claude: 'Stop',
  codex: 'Stop',
};

const HARNESS_MARKER = 'harness-main';

// ─── Utilities ───────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function upsertTomlBoolean(content, sectionName, key, value) {
  const lines = content ? content.split(/\r?\n/) : [];
  const sectionHeader = `[${sectionName}]`;
  const sectionIndex = lines.findIndex(line => line.trim() === sectionHeader);
  const keyLine = `${key} = ${value ? 'true' : 'false'}`;

  if (sectionIndex === -1) {
    const prefix = content && !content.endsWith('\n') ? '\n' : '';
    return `${content || ''}${prefix}${sectionHeader}\n${keyLine}\n`;
  }

  let sectionEnd = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[.*\]\s*$/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }

  for (let index = sectionIndex + 1; index < sectionEnd; index += 1) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[index])) {
      lines[index] = keyLine;
      return `${lines.join('\n')}\n`;
    }
  }

  lines.splice(sectionEnd, 0, keyLine);
  return `${lines.join('\n')}\n`;
}

function removeTomlKey(content, key) {
  const lines = content ? content.split(/\r?\n/) : [];
  const filteredLines = lines.filter(line => !new RegExp(`^\\s*${key}\\s*=`).test(line));
  return filteredLines.length === 0 ? '' : `${filteredLines.join('\n')}\n`;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function resolveCodexCliPath() {
  const candidates = [];
  if (process.env.CODEX_CLI_PATH) candidates.push(process.env.CODEX_CLI_PATH);
  try {
    const fromPath = execFileSync('bash', ['-lc', 'command -v codex'], { encoding: 'utf8' }).trim();
    if (fromPath) candidates.push(fromPath);
  } catch (_) {}
  return [...new Set(candidates)].find(isExecutable) || null;
}

// ─── Load Config ─────────────────────────────────────────────────────────────

const configLocalPath = path.join(skillDir, 'harness.config.local.json');
const configDefaultPath = path.join(skillDir, 'harness.config.json');
const activeConfigPath = fs.existsSync(configLocalPath) ? configLocalPath : configDefaultPath;

if (!fs.existsSync(activeConfigPath)) {
  console.error(`❌ Config not found: ${activeConfigPath}`);
  process.exit(1);
}

const config = readJson(activeConfigPath);
const platforms = config.platforms || {};
const harnessCommand = `node ${mainKernelPath}`;

// Warn if user customized a now-fixed hook_event
for (const [platform, pcfg] of Object.entries(platforms)) {
  if (pcfg && typeof pcfg === 'object' && pcfg.hook_event && pcfg.hook_event !== PLATFORM_EVENTS[platform]) {
    console.warn(`⚠️  platforms.${platform}.hook_event='${pcfg.hook_event}' is ignored in v2; fixed to '${PLATFORM_EVENTS[platform]}'. Remove the field from your config.`);
  }
}

// ─── Platform Installers ─────────────────────────────────────────────────────

function installGemini(platformConfig) {
  const scope = platformConfig.scope || 'project';
  const settingsPath = scope === 'global'
    ? path.join(os.homedir(), '.gemini', 'settings.json')
    : path.join(cwd, '.gemini', 'settings.json');

  const settings = readJson(settingsPath, {});
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.AfterAgent) settings.hooks.AfterAgent = [];

  const groups = settings.hooks.AfterAgent;
  const existingGroup = groups.find(g => g.hooks && g.hooks.some(h => typeof h.command === 'string' && h.command.includes(HARNESS_MARKER)));

  if (existingGroup) {
    existingGroup.hooks.forEach(h => { if (h.name === 'harness-reviewer' || (h.command && h.command.includes(HARNESS_MARKER))) h.command = harnessCommand; });
  } else {
    groups.push({
      matcher: "*",
      hooks: [{ name: "harness-reviewer", type: "command", command: harnessCommand }],
    });
  }

  writeJson(settingsPath, settings);
  console.log(`✅ Gemini CLI: hook registered (${scope}) → ${settingsPath}`);
}

function installClaude(platformConfig) {
  const scope = platformConfig.scope || 'project';
  const settingsPath = scope === 'global'
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(cwd, '.claude', 'settings.json');

  const settings = readJson(settingsPath, {});
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.Stop) settings.hooks.Stop = [];

  const groups = settings.hooks.Stop;
  const existingGroup = groups.find(g => g.hooks && g.hooks.some(h => typeof h.command === 'string' && h.command.includes(HARNESS_MARKER)));

  if (existingGroup) {
    existingGroup.hooks.forEach(h => { if (h.command && h.command.includes(HARNESS_MARKER)) h.command = harnessCommand; });
  } else {
    groups.push({
      matcher: "",
      hooks: [{ type: "command", command: harnessCommand }],
    });
  }

  writeJson(settingsPath, settings);
  console.log(`✅ Claude Code: hook registered (${scope}) → ${settingsPath}`);
}

function installCodex(platformConfig) {
  const codexDir = path.join(os.homedir(), '.codex');
  const hooksPath = path.join(codexDir, 'hooks.json');
  const tomlPath = path.join(codexDir, 'config.toml');

  ensureDir(codexDir);

  const hooksConfig = readJson(hooksPath, {});
  if (!hooksConfig.hooks) hooksConfig.hooks = {};
  if (!hooksConfig.hooks.Stop) hooksConfig.hooks.Stop = [];

  const stopGroups = hooksConfig.hooks.Stop;
  const existingGroup = stopGroups.find(group =>
    Array.isArray(group.hooks) &&
    group.hooks.some(hook => hook.type === 'command' && typeof hook.command === 'string' && hook.command.includes(HARNESS_MARKER))
  );

  if (!existingGroup) {
    stopGroups.push({ hooks: [{ type: "command", command: harnessCommand }] });
  } else {
    existingGroup.hooks.forEach(h => { if (h.command && h.command.includes(HARNESS_MARKER)) h.command = harnessCommand; });
  }

  writeJson(hooksPath, hooksConfig);

  let toml = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, 'utf8') : '';
  toml = removeTomlKey(toml, 'notify');
  toml = removeTomlKey(toml, 'codex_hooks');
  toml = upsertTomlBoolean(toml, 'features', 'hooks', true);
  fs.writeFileSync(tomlPath, toml);

  console.log(`✅ Codex CLI: hook registered (global) → ${hooksPath}`);
}

function installKiro() {
  // Opt-in only. By default, do nothing — even if Kiro dirs exist.
  const kiroConfigDir = path.join(os.homedir(), '.config', 'Kiro');
  const kiroExtensionsDir = path.join(os.homedir(), '.kiro', 'extensions');
  if (!fs.existsSync(kiroConfigDir) && !fs.existsSync(kiroExtensionsDir)) return;

  const codexCliPath = resolveCodexCliPath();
  if (!codexCliPath) {
    console.log(`⚠️  Kiro detected, but no Codex CLI found on PATH. Skipping.`);
    return;
  }

  const settingsPath = path.join(kiroConfigDir, 'User', 'settings.json');
  const settings = readJson(settingsPath, {});
  settings['chatgpt.cliExecutable'] = codexCliPath;
  writeJson(settingsPath, settings);
  console.log(`✅ Kiro: configured to use Codex CLI → ${codexCliPath}`);
}

// ─── Execute Installation ────────────────────────────────────────────────────

const results = { installed: [], skipped: [], warnings: [] };

if (platforms.gemini && platforms.gemini.enabled) {
  installGemini(platforms.gemini);
  results.installed.push('Gemini CLI');
} else {
  results.skipped.push('Gemini CLI');
}

if (platforms.claude && platforms.claude.enabled) {
  installClaude(platforms.claude);
  results.installed.push('Claude Code');
} else {
  results.skipped.push('Claude Code');
}

if (platforms.codex && platforms.codex.enabled) {
  installCodex(platforms.codex);
  results.installed.push('Codex CLI');
  if (config.kiro && config.kiro.auto_configure === true) {
    installKiro();
  } else if (fs.existsSync(path.join(os.homedir(), '.config', 'Kiro')) || fs.existsSync(path.join(os.homedir(), '.kiro', 'extensions'))) {
    console.log(`ℹ️  Kiro detected but not auto-configured. Set kiro.auto_configure=true in config to enable.`);
  }
} else {
  results.skipped.push('Codex CLI');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n✨ Harness v${VERSION} deployed.`);
console.log(`   Mode: ${(config.audit && config.audit.mode) || 'regex'}`);
console.log(`   Installed: ${results.installed.join(', ') || '(none)'}`);
if (results.skipped.length > 0) {
  console.log(`   Skipped (disabled): ${results.skipped.join(', ')}`);
}
console.log(`\n📁 Manage everything in one place:`);
console.log(`   Config: ${activeConfigPath}`);
console.log(`   Rules:  ${path.join(skillDir, 'rules.md')}`);
console.log(`\n📋 Post-install:`);
if (results.installed.includes('Codex CLI')) {
  console.log(`   • Codex: Run /hooks to trust the hook on first use.`);
}
if (results.installed.includes('Gemini CLI')) {
  console.log(`   • Gemini: Approve the hook trust prompt on first trigger.`);
}
if (results.installed.includes('Claude Code')) {
  console.log(`   • Claude: Active immediately.`);
}
