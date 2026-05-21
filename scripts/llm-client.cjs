#!/usr/bin/env node

const https = require('https');

/**
 * Universal LLM Client for Harness Auditor (V4.0)
 */
async function callAuditor(prompt, config, rules) {
  const { provider, model, api_key, endpoint } = config;

  return new Promise((resolve, reject) => {
    if (!endpoint || !model) {
      reject(new Error('Audit configuration is incomplete.'));
      return;
    }

    const systemPrompt = rules;

    let body = {};
    let headers = { 'Content-Type': 'application/json' };
    let url = endpoint;

    if (provider === 'openai') {
      headers['Authorization'] = `Bearer ${api_key}`;
    }

    if (provider === 'openai' || provider === 'ollama') {
      body = {
        model: model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
        temperature: 0.1
      };
    }

    const req = https.request(url, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Audit request failed (${res.statusCode}): ${data.slice(0, 500)}`));
          return;
        }

        try {
          const json = JSON.parse(data);
          resolve(json.choices[0].message.content.trim());
        } catch (e) {
          reject(new Error('Audit Call Failed: ' + data.slice(0, 500)));
        }
      });
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error('Audit request timed out.'));
    });
    req.on('error', (e) => reject(e));
    req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = { callAuditor };
