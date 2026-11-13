import test from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_GROUPS, countByGroup, flattenResults, stepIndex, visibleItems } from './search-view.js';

test('空结果与 null 都拉平为空数组', () => {
  assert.deepEqual(flattenResults(null), []);
  assert.deepEqual(flattenResults({}), []);
});

test('按项目 / 需求 / 日志 / 提交的顺序拉平', () => {
  const data = {
    projects: [{ projectId: 'p1' }],
    requirements: [{ id: 'r1' }],
    logs: [{ runId: 'l1' }],
    commits: [{ sha: 'c1' }]
  };
  const rows = flattenResults(data);
  assert.deepEqual(
    rows.map((r) => r.group),
    SEARCH_GROUPS.map((g) => g.key)
  );
  assert.deepEqual(rows.map((r) => r.item), [
    { projectId: 'p1' },
    { id: 'r1' },
    { runId: 'l1' },
    { sha: 'c1' }
  ]);
});

test('键盘步进到头循环，空列表固定 0', () => {
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(0, 0, 1), 0);
});

test('各组条数缺省为 0', () => {
  assert.deepEqual(countByGroup({ projects: [1, 2], logs: [3] }), {
    projects: 2,
    requirements: 0,
    logs: 1,
    commits: 0
  });
});

test('未展开的组只显示 5 条，点击查看更多后显示 10 条', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: i }));
  const data = { requirements: many, more: { requirements: true } };
  assert.equal(visibleItems(data, 'requirements').length, 5);
  assert.equal(visibleItems(data, 'requirements', { requirements: true }).length, 10);
  assert.equal(flattenResults(data).length, 5);
  assert.equal(flattenResults(data, { requirements: true }).length, 10);
  assert.equal(countByGroup(data).requirements, 5);
  assert.equal(countByGroup(data, { requirements: true }).requirements, 10);
});

test('只展开的组放到 10 条，其余组仍截回 5 条', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: 'r' + i }));
  const data = { requirements: ten, commits: ten };
  const expanded = { requirements: true };
  assert.deepEqual(
    flattenResults(data, expanded).map((r) => r.group),
    // 需求 10 条 + 提交 5 条
    [...Array(10).fill('requirements'), ...Array(5).fill('commits')]
  );
  assert.deepEqual(countByGroup(data, expanded), {
    projects: 0,
    requirements: 10,
    logs: 0,
    commits: 5
  });
});
