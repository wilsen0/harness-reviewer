#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const skillDir = path.resolve(__dirname, '..');
const mainKernelPath = path.join(skillDir, 'scripts', 'harness-main.cjs');
const cwd = process.cwd();

console.log(`🚀 Starting Closed-Loop Harness Installation...`);
console.log(`📍 Skill Source: ${skillDir}`);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function ensureHarnessConfig(platformDir) {
  const configPath = path.join(cwd, platformDir, 'harness-config.json');
  ensureHarnessConfigAt(configPath);
}

function ensureHarnessConfigAt(configPath) {
  if (!fs.existsSync(configPath)) {
    writeJson(configPath, {
      mode: "regex",
      llm_config: {
        provider: "openai",
        model: "qwen/qwen3.6-plus-preview:free",
        api_key: "sk-or-v1-...",
        endpoint: "https://openrouter.ai/api/v1/chat/completions"
      }
    });
  }
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
  } catch (error) {
    return false;
  }
}

function resolveCodexCliPath() {
  const candidates = [];

  if (process.env.CODEX_CLI_PATH) candidates.push(process.env.CODEX_CLI_PATH);

  try {
    const fromPath = execFileSync('bash', ['-lc', 'command -v codex'], { encoding: 'utf8' }).trim();
    if (fromPath) candidates.push(fromPath);
  } catch (error) {}

  return [...new Set(candidates)].find(isExecutable) || null;
}

/**
 * Update Platform Config
 */
function registerHook(platformDir, settingsFile, hookType, configSetter) {
  const settingsPath = path.join(cwd, platformDir, settingsFile);
  ensureDir(path.dirname(settingsPath));
  let settings = readJson(settingsPath, {});

  settings = configSetter(settings);
  writeJson(settingsPath, settings);
  ensureHarnessConfig(platformDir);
  console.log(`✅ Hook registered for ${platformDir}`);
}

function registerCodexGlobalHook() {
  const codexDir = path.join(os.homedir(), '.codex');
  const hooksPath = path.join(codexDir, 'hooks.json');
  const configPath = path.join(codexDir, 'config.toml');

  ensureDir(codexDir);

  let hooksConfig = {};
  if (fs.existsSync(hooksPath)) {
    try { hooksConfig = JSON.parse(fs.readFileSync(hooksPath, 'utf8')); } catch (e) {}
  }

  if (!hooksConfig.hooks) hooksConfig.hooks = {};
  if (!hooksConfig.hooks.Stop) hooksConfig.hooks.Stop = [];

  const stopGroups = hooksConfig.hooks.Stop;
  const existingGroup = stopGroups.find(group =>
    Array.isArray(group.hooks) &&
    group.hooks.some(hook => hook.type === 'command' && hook.command === `node ${mainKernelPath}`)
  );

  if (!existingGroup) {
    stopGroups.push({
      hooks: [
        {
          type: "command",
          command: `node ${mainKernelPath}`
        }
      ]
    });
  }

  writeJson(hooksPath, hooksConfig);

  let nextToml = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  nextToml = removeTomlKey(nextToml, 'notify');
  nextToml = upsertTomlBoolean(nextToml, 'features', 'codex_hooks', true);
  fs.writeFileSync(configPath, nextToml);

  ensureHarnessConfigAt(path.join(codexDir, 'harness-config.json'));
  console.log(`✅ Hook registered for ~/.codex`);
}

function registerKiroCodexExecutable() {
  const kiroConfigDir = path.join(os.homedir(), '.config', 'Kiro');
  const kiroExtensionsDir = path.join(os.homedir(), '.kiro', 'extensions');

  if (!fs.existsSync(kiroConfigDir) && !fs.existsSync(kiroExtensionsDir)) return;

  const codexCliPath = resolveCodexCliPath();
  if (!codexCliPath) {
    console.log(`⚠️  Kiro detected, but no Codex CLI was found on PATH. Skipping Kiro Codex wiring.`);
    return;
  }

  const settingsPath = path.join(kiroConfigDir, 'User', 'settings.json');
  const settings = readJson(settingsPath, {});
  settings['chatgpt.cliExecutable'] = codexCliPath;
  writeJson(settingsPath, settings);
  console.log(`✅ Kiro configured to use Codex CLI: ${codexCliPath}`);
}

// 1. Gemini CLI
if (fs.existsSync(path.join(cwd, '.gemini'))) {
  registerHook('.gemini', 'settings.json', 'AfterAgent', (s) => {
    if (!s.hooks) s.hooks = {};
    if (!s.hooks.AfterAgent) s.hooks.AfterAgent = [];
    const exists = s.hooks.AfterAgent.some(g => g.hooks && g.hooks.some(h => h.name === 'harness-reviewer'));
    if (!exists) {
      s.hooks.AfterAgent.push({
        matcher: "*",
        hooks: [{ name: "harness-reviewer", type: "command", command: `node ${mainKernelPath}` }]
      });
    } else {
      // Update existing command path
      s.hooks.AfterAgent.forEach(g => {
        g.hooks.forEach(h => { if (h.name === 'harness-reviewer') h.command = `node ${mainKernelPath}`; });
      });
    }
    return s;
  });
}

// 2. Claude Code
if (fs.existsSync(path.join(cwd, '.claude'))) {
  registerHook('.claude', 'settings.json', 'Stop', (s) => {
    if (!s.hooks) s.hooks = {};
    if (!s.hooks.Stop) s.hooks.Stop = [];
    const exists = s.hooks.Stop.some(g => g.hooks && g.hooks.some(h => h.name === 'harness-reviewer'));
    if (!exists) {
      s.hooks.Stop.push({
        hooks: [{ name: "harness-reviewer", type: "command", command: `node ${mainKernelPath}` }]
      });
    } else {
      s.hooks.Stop.forEach(g => {
        g.hooks.forEach(h => { if (h.name === 'harness-reviewer') h.command = `node ${mainKernelPath}`; });
      });
    }
    return s;
  });
}

// 3. Codex CLI / IDE extension (global hooks/config)
registerCodexGlobalHook();
registerKiroCodexExecutable();

console.log(`\n✨ Harness V4.0 (Closed-Loop) deployed successfully.`);
console.log(`💡 Rules are centrally managed in: ${path.join(skillDir, 'rules.md')}`);
