#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const TIMEOUT_MS = 15000;
const RETRY_BACKOFF_MS = 500;
const MAX_ATTEMPTS = 2;
const RETRYABLE_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']);
const RETRYABLE_HTTP = new Set([502, 503, 504]);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('llm_config 缺失或不是对象。');
  }
  if (!config.endpoint || typeof config.endpoint !== 'string') {
    throw new Error('llm_config.endpoint 缺失。');
  }
  if (!config.model || typeof config.model !== 'string') {
    throw new Error('llm_config.model 缺失。');
  }
  if (config.provider === 'openai' && (!config.api_key || !config.api_key.trim())) {
    throw new Error('llm_config.api_key 为空（openai provider 必须填）。');
  }
}

function buildRequestOptions(config) {
  let url;
  try {
    url = new URL(config.endpoint);
  } catch (_) {
    throw new Error(`endpoint 不是合法 URL：${config.endpoint}`);
  }
  const isHttps = url.protocol === 'https:';
  const headers = { 'Content-Type': 'application/json' };
  if (config.provider === 'openai' && config.api_key) {
    headers['Authorization'] = `Bearer ${config.api_key}`;
  }
  return { url, isHttps, headers };
}

function callOnce(config, systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const { url, isHttps, headers } = buildRequestOptions(config);
    const body = JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: typeof config.temperature === 'number' ? config.temperature : 0.1,
    });

    const transport = isHttps ? https : http;
    const req = transport.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`LLM HTTP ${res.statusCode}: ${data.slice(0, 500)}`);
          err.statusCode = res.statusCode;
          err.body = data.slice(0, 500);
          reject(err);
          return;
        }
        try {
          const json = JSON.parse(data);
          const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          if (typeof content !== 'string') {
            reject(new Error('LLM 响应缺少 choices[0].message.content'));
            return;
          }
          resolve(content.trim());
        } catch (e) {
          reject(new Error('LLM 响应解析失败：' + data.slice(0, 500)));
        }
      });
    });

    req.setTimeout(TIMEOUT_MS, () => {
      const err = new Error(`LLM 请求超时 (${TIMEOUT_MS}ms)`);
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

async function callAuditor(prompt, config, rules) {
  validateConfig(config);
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callOnce(config, rules, prompt);
    } catch (e) {
      lastErr = e;
      const retryable = e && (RETRYABLE_CODES.has(e.code) || RETRYABLE_HTTP.has(e.statusCode));
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw e;
      }
      await delay(RETRY_BACKOFF_MS);
    }
  }
  throw lastErr || new Error('LLM 调用失败（未知原因）');
}

module.exports = { callAuditor, validateConfig };
