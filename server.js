'use strict';

const path = require('path');
const express = require('express');
const { analyze } = require('./lib/analyzer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /api/analyze
 * body: { rules: [{ method: string, path: string }],
 *         samples?: ["METHOD /path" | { method, path }] }
 * 规则在数组中的顺序即优先级（索引 0 最先匹配）。
 * 提供 samples 时，响应额外包含 replay（逐条首条命中）与 fixPlan.replay（调整前后对比）。
 */
app.post('/api/analyze', (req, res) => {
  const body = req.body || {};
  const rules = body.rules;
  if (!Array.isArray(rules)) {
    return res.status(400).json({ error: '请求体必须为 { rules: [...] }（可选 samples: [...]）' });
  }
  if (rules.length > 500) {
    return res.status(400).json({ error: '规则数量不能超过 500 条' });
  }
  const samples = body.samples;
  if (samples !== undefined) {
    if (!Array.isArray(samples)) {
      return res.status(400).json({ error: 'samples 必须是数组（“方法 路径”字符串或 { method, path }）' });
    }
    if (samples.length > 200) {
      return res.status(400).json({ error: '请求样例数量不能超过 200 条' });
    }
  }
  res.json(analyze(rules, { samples }));
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`路由冲突实验室已启动: http://localhost:${PORT}`);
});
