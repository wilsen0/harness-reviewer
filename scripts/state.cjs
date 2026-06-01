#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const STATE_VERSION = 2;
const TTL_DAYS = 7;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;
const MAX_HISTORY = 50;

function resolveStateDir(config) {
  if (config && typeof config.state_dir === 'string' && config.state_dir.trim()) {
    return config.state_dir;
  }
  return path.join(process.cwd(), '.harness', 'state');
}

function createDefaultState(sessionId) {
  return {
    version: STATE_VERSION,
    session_id: sessionId,
    deny_count: 0,
    consecutive_passes: 0,
    last_scenario: null,
    last_decision: null,
    last_seen_ts: new Date().toISOString(),
    denial_history: [],
    effective_mode: 'regex',
    v1_magic_word_seen: false,
  };
}

function atomicWrite(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function read(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!obj || obj.version !== STATE_VERSION) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      return null;
    }
    return obj;
  } catch (_) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    return null;
  }
}

function loadOrCreate(stateDir, sessionId) {
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, `${sanitizeId(sessionId)}.json`);
  const existing = read(filePath);
  if (existing) return { state: existing, filePath };
  const state = createDefaultState(sessionId);
  atomicWrite(filePath, state);
  return { state, filePath };
}

function save(filePath, state) {
  state.last_seen_ts = new Date().toISOString();
  atomicWrite(filePath, state);
}

function prune(stateDir) {
  if (!fs.existsSync(stateDir)) return 0;
  const now = Date.now();
  let pruned = 0;
  for (const name of fs.readdirSync(stateDir)) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const p = path.join(stateDir, name);
    try {
      const stat = fs.statSync(p);
      if (now - stat.mtimeMs > TTL_MS) {
        fs.unlinkSync(p);
        pruned += 1;
      }
    } catch (_) {}
  }
  return pruned;
}

function listSessions(stateDir) {
  if (!fs.existsSync(stateDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(stateDir)) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const p = path.join(stateDir, name);
    try {
      const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (obj && obj.version === STATE_VERSION) {
        out.push({
          file: name,
          session_id: obj.session_id,
          deny_count: obj.deny_count || 0,
          effective_mode: obj.effective_mode,
          last_seen_ts: obj.last_seen_ts,
        });
      }
    } catch (_) {}
  }
  return out;
}

function recordDeny(state, scenario, failedFields) {
  state.deny_count = (state.deny_count || 0) + 1;
  state.consecutive_passes = 0;
  state.last_scenario = scenario;
  state.last_decision = 'deny';
  state.denial_history.push({
    scenario,
    failed_fields: Array.isArray(failedFields) ? failedFields : [],
    ts: new Date().toISOString(),
  });
  if (state.denial_history.length > MAX_HISTORY) {
    state.denial_history = state.denial_history.slice(-MAX_HISTORY);
  }
}

function recordPass(state, scenario) {
  state.consecutive_passes = (state.consecutive_passes || 0) + 1;
  state.last_scenario = scenario;
  state.last_decision = 'pass';
  if (state.consecutive_passes >= 3) {
    state.deny_count = 0;
  }
}

function shouldEscalate(state) {
  return (state.deny_count || 0) >= 2 && state.effective_mode !== 'llm';
}

function shouldHardBlock(state) {
  return (state.deny_count || 0) >= 4;
}

function sanitizeId(id) {
  if (typeof id !== 'string' || !id) return 'unknown';
  return id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'unknown';
}

module.exports = {
  STATE_VERSION,
  resolveStateDir,
  createDefaultState,
  loadOrCreate,
  save,
  prune,
  listSessions,
  recordDeny,
  recordPass,
  shouldEscalate,
  shouldHardBlock,
  sanitizeId,
};
