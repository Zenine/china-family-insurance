import test from 'node:test';
import assert from 'node:assert/strict';

test('Node 主版本 >= 20', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.ok(major >= 20, `当前 Node ${process.versions.node}`);
});
