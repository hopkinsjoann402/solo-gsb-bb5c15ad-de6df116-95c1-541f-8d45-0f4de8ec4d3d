'use strict';

const assert = require('assert');
const { analyze, covers, buildDFA, parsePath, shortestIntersectionWord } = require('../lib/analyzer');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function dfa(path) {
  const { tokens } = parsePath(path);
  return buildDFA(tokens);
}
function coversP(a, b) {
  return covers(dfa(a), dfa(b));
}
function shortest(a, b) {
  return shortestIntersectionWord(dfa(a), dfa(b));
}

// ---------- 覆盖关系 ----------
check('* 覆盖一切', () => {
  assert.strictEqual(coversP('/*', '/a/b/c'), true);
  assert.strictEqual(coversP('/*', '/'), true);
});
check('具体路径不被 * 反向覆盖之外：/a 不覆盖 /*', () => {
  assert.strictEqual(coversP('/a', '/*'), false);
});
check('/users/:id 覆盖 /users/123 这类单段', () => {
  assert.strictEqual(coversP('/users/:id', '/users/123'), true);
  assert.strictEqual(coversP('/users/:id', '/users/123/posts'), false);
});
check('/users/* 覆盖 /users/:id 及其子路径', () => {
  assert.strictEqual(coversP('/users/*', '/users/:id'), true);
  assert.strictEqual(coversP('/users/*', '/users/:id/posts'), true);
  assert.strictEqual(coversP('/users/*', '/users'), true);
  assert.strictEqual(coversP('/users/*', '/orders/1'), false);
});
check('相同模式互相覆盖', () => {
  assert.strictEqual(coversP('/a/:x', '/a/:y'), true);
});
check('/ 根路径只覆盖自己', () => {
  assert.strictEqual(coversP('/', '/'), true);
  assert.strictEqual(coversP('/', '/a'), false);
  assert.strictEqual(coversP('/*', '/'), true);
});
check('字面量分流不覆盖', () => {
  assert.strictEqual(coversP('/a/x', '/b/x'), false);
});
check('/api/* 与 /api/:v/health：参数需非空，不覆盖无段情形但覆盖有段', () => {
  assert.strictEqual(coversP('/api/*', '/api/:v/health'), true);
  assert.strictEqual(coversP('/api/:v/health', '/api/*'), false);
});
check('双通配 /a/*/b/* 覆盖情形', () => {
  assert.strictEqual(coversP('/a/*/b/*', '/a/x/b/y/z'), true);
  assert.strictEqual(coversP('/a/*/b/*', '/a/b'), true); // 两个 * 均匹配零段
  assert.strictEqual(coversP('/a/*/b/*', '/a/x/c'), false);
});

// ---------- 最短交集路径 ----------
check('交集最短：/users/:id 与 /users/* -> /users/a', () => {
  assert.strictEqual(shortest('/users/:id', '/users/*'), '/users/a');
});
check('交集最短：/a/* 与 /*/b -> /a/b（单段同时满足）', () => {
  assert.strictEqual(shortest('/a/*', '/*/b'), '/a/b');
});
check('交集最短：根 / 与 /* -> /', () => {
  assert.strictEqual(shortest('/', '/*'), '/');
});
check('无交集返回 null：/a 与 /b', () => {
  assert.strictEqual(shortest('/a', '/b'), null);
});
check('无交集返回 null：/a/x 与 /a/:p/y（段数不同）', () => {
  assert.strictEqual(shortest('/a/x', '/a/:p/y'), null);
});
check('字典序并列取最小：/x/:p 与 /x/* 可取任意字面量时取 a', () => {
  assert.strictEqual(shortest('/x/:p', '/x/*'), '/x/a');
});
check('字面量优先于自由值成为最短路径一部分', () => {
  // /z/:p vs /z/*：两条都在 /z/<段> 命中，自由值 a < z
  assert.strictEqual(shortest('/z/:p', '/z/*'), '/z/a');
});
check('/a/* 与 /:p/b 最短交集为 /a/b', () => {
  assert.strictEqual(shortest('/a/*', '/:p/b'), '/a/b');
});

// ---------- analyze 集成 ----------
function ids(conflicts, kind) {
  return conflicts.filter((c) => c.type === kind).map((c) => [c.higher.id, c.lower.id]);
}

check('analyze: 完全遮蔽检测 + 示例', () => {
  const res = analyze([
    { id: 'a', method: 'GET', path: '/users/*' },
    { id: 'b', method: 'GET', path: '/users/:id' },
  ]);
  assert.strictEqual(res.summary.shadow, 1);
  assert.strictEqual(res.summary.partial, 0);
  assert.deepStrictEqual(ids(res.conflicts, 'shadow'), [['a', 'b']]);
  assert.strictEqual(res.conflicts[0].example, 'GET /users/a');
});

check('analyze: 部分重叠检测', () => {
  const res = analyze([
    { id: 'a', method: 'GET', path: '/a/*' },
    { id: 'b', method: 'GET', path: '/*/b' },
  ]);
  assert.strictEqual(res.summary.shadow, 0);
  assert.strictEqual(res.summary.partial, 1);
  assert.strictEqual(res.conflicts[0].example, 'GET /a/b');
});

check('analyze: 不同方法互不冲突', () => {
  const res = analyze([
    { id: 'a', method: 'GET', path: '/users/*' },
    { id: 'b', method: 'POST', path: '/users/*' },
  ]);
  assert.strictEqual(res.summary.total, 0);
});

check('analyze: ALL 与任意具体方法冲突', () => {
  const res = analyze([
    { id: 'a', method: 'ALL', path: '/users/:id' },
    { id: 'b', method: 'DELETE', path: '/users/:id' },
  ]);
  assert.strictEqual(res.summary.shadow, 1);
  assert.strictEqual(res.conflicts[0].method, 'DELETE');
});

check('analyze: 静态规则被通配规则遮蔽，示例为静态字面量', () => {
  const res = analyze([
    { id: 'a', method: 'GET', path: '/*' },
    { id: 'b', method: 'GET', path: '/health' },
  ]);
  assert.strictEqual(res.summary.shadow, 1);
  assert.strictEqual(res.conflicts[0].example, 'GET /health');
});

check('analyze: 无效规则被跳过并给出错误', () => {
  const res = analyze([
    { id: 'a', method: 'GET', path: 'users/missing-slash' },
    { id: 'b', method: 'GET', path: '/ok' },
  ]);
  assert.strictEqual(res.rules[0].valid, false);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.summary.total, 0);
});

check('analyze: 优先级由数组顺序决定，交换后遮蔽方向相反', () => {
  const r1 = analyze([
    { id: 'a', method: 'GET', path: '/users/*' },
    { id: 'b', method: 'GET', path: '/users/:id' },
  ]);
  const r2 = analyze([
    { id: 'b', method: 'GET', path: '/users/:id' },
    { id: 'a', method: 'GET', path: '/users/*' },
  ]);
  // 互换优先级后：:id 不遮蔽 *，仅在 /users/:id 单段处重叠
  assert.strictEqual(r1.conflicts[0].type, 'shadow');
  assert.strictEqual(r2.conflicts[0].type, 'partial');
  assert.strictEqual(r2.conflicts[0].example, 'GET /users/a');
});

check('analyze: 默认实验室示例集结果稳定', () => {
  const res = analyze([
    { method: 'GET', path: '/api/*' },
    { method: 'GET', path: '/api/users/*' },
    { method: 'GET', path: '/api/users/:id' },
    { method: 'GET', path: '/assets/*' },
    { method: 'GET', path: '/assets/css/*' },
    { method: 'GET', path: '/a/*/c' },
    { method: 'GET', path: '/*/b/c' },
    { method: 'POST', path: '/api/users' },
  ]);
  // 遮蔽：0->1、0->2、1->2、3->4
  assert.strictEqual(res.summary.shadow, 4);
  // 部分重叠：5(/a/*/c) 与 6(/*/b/c) 等
  const overlap56 = res.conflicts.find(
    (c) => c.type === 'partial' && c.higher.index === 5 && c.lower.index === 6
  );
  assert.ok(overlap56, '应检出 /a/*/c 与 /*/b/c 的部分重叠');
  assert.strictEqual(overlap56.example, 'GET /a/b/c');
});

// ---------- 修复方案（重排） ----------
function isPermutation(order, n) {
  return (
    Array.isArray(order) &&
    order.length === n &&
    order.slice().sort((a, b) => a - b).every((v, i) => v === i)
  );
}

check('fixPlan: 严格覆盖的遮蔽全部可经重排消除，结果无遮蔽', () => {
  const rules = [
    { id: 'a', method: 'GET', path: '/users/*' },
    { id: 'b', method: 'GET', path: '/users/:id' },
  ];
  const f = analyze(rules).fixPlan;
  assert.strictEqual(f.needed, true);
  assert.strictEqual(f.feasible, true);
  assert.strictEqual(f.shadowBefore, 1);
  assert.strictEqual(f.shadowAfter, 0);
  assert.strictEqual(f.unavoidableShadow, 0);
  assert.strictEqual(f.fixedCount, 1);
  // 更具体的 b 必须排在严格覆盖它的 a 之前
  assert.deepStrictEqual(f.order, [1, 0]);
  assert.ok(isPermutation(f.order, rules.length));
  // 位置调整：b 2->1，a 1->2
  assert.deepStrictEqual(f.moves.map((m) => [m.rule.id, m.from, m.to]), [
    ['b', 2, 1],
    ['a', 1, 2],
  ]);
  // 约束图边：narrower=b -> wider=a
  assert.strictEqual(f.constraints.length, 1);
  assert.strictEqual(f.constraints[0].narrower.id, 'b');
  assert.strictEqual(f.constraints[0].wider.id, 'a');
});

check('fixPlan: 默认示例集中 4 条严格覆盖遮蔽全部可修复，转换为重叠', () => {
  const res = analyze([
    { method: 'GET', path: '/api/*' },
    { method: 'GET', path: '/api/users/*' },
    { method: 'GET', path: '/api/users/:id' },
    { method: 'GET', path: '/assets/*' },
    { method: 'GET', path: '/assets/css/*' },
    { method: 'GET', path: '/a/*/c' },
    { method: 'GET', path: '/*/b/c' },
    { method: 'POST', path: '/api/users' },
  ]);
  const f = res.fixPlan;
  assert.strictEqual(f.shadowAfter, 0);
  assert.strictEqual(f.unavoidableShadow, 0);
  assert.ok(isPermutation(f.order, 8));
  // 顺序约束：:id 在 /users/* 在 /api/* 之前；/assets/css/* 在 /assets/* 之前
  const pos = (i) => f.order.indexOf(i);
  assert.ok(pos(2) < pos(1) && pos(1) < pos(0));
  assert.ok(pos(4) < pos(3));
  // 部分重叠数：原 5 + 转为重叠的 4 = 9，遮蔽 0
  assert.strictEqual(f.partialAfter, 9);
});

check('fixPlan: 路径语言等价的重复规则标为不可消除，不伪装为已修复', () => {
  const res = analyze([
    { id: 'a', method: 'GET', path: '/dup/:x' },
    { id: 'b', method: 'GET', path: '/dup/:y' },
  ]);
  const f = res.fixPlan;
  assert.strictEqual(f.shadowBefore, 1);
  assert.strictEqual(f.shadowAfter, 1); // 排序后依旧遮蔽
  assert.strictEqual(f.fixedCount, 0);
  assert.strictEqual(f.unavoidableShadow, 1);
  assert.strictEqual(f.equivalenceGroups.length, 1);
  assert.strictEqual(f.equivalenceGroups[0].resolvableByOrder, false);
  assert.strictEqual(f.equivalenceGroups[0].unavoidableShadow, 1);
  assert.strictEqual(f.unavoidablePairs.length, 1);
  assert.deepStrictEqual(
    f.unavoidablePairs[0].a.id < f.unavoidablePairs[0].b.id ? ['a', 'b'] : ['b', 'a'],
    ['a', 'b']
  );
  // 无约束边：等价关系不产生排序约束
  assert.strictEqual(f.constraints.length, 0);
});

check('fixPlan: GET/ALL 同路径也属不可消除等价组，且具体规则仍约束通配规则', () => {
  const res = analyze([
    { id: 'c', method: 'GET', path: '/*' },
    { id: 'a', method: 'GET', path: '/x' },
    { id: 'b', method: 'ALL', path: '/x' },
  ]);
  const f = res.fixPlan;
  // 原始顺序：c 遮蔽 a、c 遮蔽 b；a、b 路径等价且方法兼容 -> 1 条不可消除
  assert.strictEqual(f.shadowBefore, 3);
  assert.strictEqual(f.unavoidableShadow, 1);
  assert.strictEqual(f.shadowAfter, 1);
  assert.strictEqual(f.fixedCount, 2);
  assert.strictEqual(f.equivalenceGroups.length, 1);
  assert.strictEqual(f.equivalenceGroups[0].resolvableByOrder, false);
  const pos = (i) => f.order.indexOf(i);
  // 等价组（a=1、b=2）必须在更宽泛的 c=0 之前
  assert.ok(pos(1) < pos(0) && pos(2) < pos(0));
});

check('fixPlan: 部分重叠不产生约束边，也不宣称被修复', () => {
  const f = analyze([
    { method: 'GET', path: '/a/*' },
    { method: 'GET', path: '/*/b' },
  ]).fixPlan;
  assert.strictEqual(f.needed, false); // 没有遮蔽
  assert.strictEqual(f.shadowBefore, 0);
  assert.strictEqual(f.shadowAfter, 0);
  assert.strictEqual(f.fixedCount, 0);
  assert.strictEqual(f.constraints.length, 0);
  assert.deepStrictEqual(f.order, [0, 1]);
});

check('fixPlan: 确定性——相同输入多次计算顺序完全一致', () => {
  const rules = [
    { method: 'GET', path: '/*' },
    { method: 'GET', path: '/api/*' },
    { method: 'GET', path: '/api/users/*' },
    { method: 'GET', path: '/api/users/:id' },
    { method: 'GET', path: '/assets/*' },
    { method: 'GET', path: '/assets/css/*' },
  ];
  const o1 = analyze(rules).fixPlan.order;
  const o2 = analyze(rules).fixPlan.order;
  assert.deepStrictEqual(o1, o2);
  // 更具体者在前
  assert.deepStrictEqual(o1, [3, 2, 1, 5, 4, 0]);
});

check('fixPlan: 无效规则不参与分组与约束，且应用后仍为无效规则', () => {
  const rules = [
    { method: 'GET', path: 'bad' },
    { method: 'GET', path: '/*' },
    { method: 'GET', path: '/x' },
  ];
  const f = analyze(rules).fixPlan;
  assert.ok(isPermutation(f.order, 3));
  assert.strictEqual(f.order[0], 0); // 无效规则保持原位
  assert.ok(f.order.indexOf(2) < f.order.indexOf(1)); // /x 位于 /* 之前
  assert.strictEqual(f.shadowAfter, 0);
});

check('fixPlan: 无冲突/空集时给出稳定空方案', () => {
  const f1 = analyze([
    { method: 'GET', path: '/a' },
    { method: 'POST', path: '/b' },
  ]).fixPlan;
  assert.strictEqual(f1.needed, false);
  assert.deepStrictEqual(f1.order, [0, 1]);
  assert.strictEqual(f1.moves.length, 0);
  const f2 = analyze([]).fixPlan;
  assert.deepStrictEqual(f2.order, []);
  assert.strictEqual(f2.shadowAfter, 0);
});

// ---------- 请求行为回归预演 ----------
check('replay: 按优先级返回首条命中规则（宽规则在前先命中）', () => {
  const res = analyze([
    { id: 'wide', method: 'GET', path: '/api/*' },
    { id: 'narrow', method: 'GET', path: '/api/users/:id' },
  ], { samples: ['GET /api/users/42'] });
  assert.strictEqual(res.replay.summary.total, 1);
  assert.strictEqual(res.replay.summary.matched, 1);
  assert.strictEqual(res.replay.samples[0].hit.id, 'wide');
  assert.strictEqual(res.replay.samples[0].hit.position, 1);
});

check('replay: ALL 规则匹配任意具体方法，通配符匹配零段', () => {
  const res = analyze([
    { id: 'all', method: 'ALL', path: '/health' },
    { id: 'assets', method: 'GET', path: '/assets/*' },
  ], { samples: ['DELETE /health', 'GET /assets'] });
  assert.strictEqual(res.replay.samples[0].hit.id, 'all');
  assert.strictEqual(res.replay.samples[1].hit.id, 'assets');
  assert.strictEqual(res.replay.summary.matched, 2);
});

check('replay: 参数段需非空、根路径可匹配、方法不同不命中', () => {
  const res = analyze([
    { id: 'u', method: 'GET', path: '/u/:id' },
    { id: 'root', method: 'GET', path: '/' },
  ], { samples: ['GET /u', 'GET /', 'POST /'] });
  assert.strictEqual(res.replay.samples[0].hit, null); // /u 只有一段，不匹配 /u/:id
  assert.strictEqual(res.replay.samples[1].hit.id, 'root');
  assert.strictEqual(res.replay.samples[2].hit, null); // 方法不同
  assert.strictEqual(res.replay.summary.unmatched, 2);
});

check('replay: 样例校验——方法须具体、路径须具体', () => {
  const res = analyze([{ method: 'GET', path: '/a' }], {
    samples: [
      'ALL /a',        // 真实请求不允许 ALL
      'FOO /a',        // 未知方法
      'GET a',         // 路径未以 / 开头
      'GET /a/',       // 尾斜杠
      'GET /a/:id',    // 含参数段
      'GET /a/*',      // 含通配符
      'GET /a?x=1',    // 查询串
      'GET',           // 缺路径
      'GET /a extra',  // 多余字段
    ],
  });
  const r = res.replay;
  assert.strictEqual(r.summary.valid, 0);
  assert.strictEqual(r.summary.invalid, 9);
  assert.ok(r.samples.every((s) => !s.valid && s.errors.length > 0 && s.hit === null));
});

check('replay: 对象形式样例与字符串形式等价，方法大小写不敏感', () => {
  const res = analyze([{ id: 'x', method: 'GET', path: '/a/:id' }], {
    samples: [{ method: 'get', path: '/a/1' }],
  });
  assert.strictEqual(res.replay.samples[0].valid, true);
  assert.strictEqual(res.replay.samples[0].method, 'GET');
  assert.strictEqual(res.replay.samples[0].hit.id, 'x');
});

check('replay: 无效规则不参与匹配', () => {
  const res = analyze([
    { id: 'bad', method: 'GET', path: 'no-slash' },
    { id: 'ok', method: 'GET', path: '/a' },
  ], { samples: ['GET /a'] });
  assert.strictEqual(res.replay.samples[0].hit.id, 'ok');
});

check('replay: 未提供样例时 replay 为 null，兼容旧调用', () => {
  const res = analyze([{ method: 'GET', path: '/a' }]);
  assert.strictEqual(res.replay, null);
  assert.strictEqual(res.fixPlan.replay, null);
});

check('fixPlan.replay: 标出命中改变、前后无匹配与无效样例', () => {
  const res = analyze([
    { id: 'wide', method: 'GET', path: '/api/*' },
    { id: 'narrow', method: 'GET', path: '/api/users/:id' },
  ], { samples: ['GET /api/users/42', 'GET /other', 'BAD SAMPLE X'] });
  const dr = res.fixPlan.replay;
  assert.strictEqual(dr.summary.total, 3);
  // 建议顺序为 [narrow, wide]：样例 0 的首条命中由 wide 变为 narrow
  const d0 = dr.samples[0];
  assert.strictEqual(d0.before.id, 'wide');
  assert.strictEqual(d0.after.id, 'narrow');
  assert.strictEqual(d0.after.position, 1); // narrow 在建议顺序中排第 1
  assert.strictEqual(d0.changed, true);
  assert.strictEqual(dr.summary.changed, 1);
  // 样例 1 调整前后都无匹配
  const d1 = dr.samples[1];
  assert.strictEqual(d1.unmatchedBefore, true);
  assert.strictEqual(d1.unmatchedAfter, true);
  assert.strictEqual(d1.changed, false);
  assert.strictEqual(dr.summary.unmatchedBefore, 1);
  assert.strictEqual(dr.summary.unmatchedAfter, 1);
  // 无效样例不计入无匹配标记
  const d2 = dr.samples[2];
  assert.strictEqual(d2.valid, false);
  assert.strictEqual(d2.unmatchedBefore, false);
  assert.strictEqual(d2.unmatchedAfter, false);
  assert.strictEqual(dr.summary.invalid, 1);
});

check('fixPlan.replay: 纯重排不改变“是否命中”，只可能改变命中对象', () => {
  const res = analyze([
    { method: 'GET', path: '/api/*' },
    { method: 'GET', path: '/api/users/*' },
    { method: 'GET', path: '/api/users/:id' },
    { method: 'GET', path: '/assets/*' },
    { method: 'GET', path: '/assets/css/*' },
    { method: 'POST', path: '/api/users' },
  ], {
    samples: [
      'GET /api/users/42',
      'GET /assets/css/site.css',
      'POST /api/users',
      'GET /nowhere',
    ],
  });
  const dr = res.fixPlan.replay;
  assert.strictEqual(dr.summary.changed, 2); // 前两条样例命中对象改变
  for (const d of dr.samples) {
    if (!d.valid) continue;
    assert.strictEqual(d.unmatchedBefore, d.unmatchedAfter);
  }
  // 命中改变的方向符合修复意图：更具体的规则前移后接管
  const d0 = dr.samples[0];
  assert.strictEqual(d0.before.index, 0);
  assert.strictEqual(d0.after.index, 2);
  assert.strictEqual(d0.after.position, 1);
});


console.log(`\n全部 ${passed} 个测试通过。`);
