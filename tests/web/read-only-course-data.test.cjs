const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Isolate the persistence hook from the network and advance its effects/timers.
function harness(readOnly, loadError = null) {
  const state = [];
  const effects = [];
  const timers = [];
  const writes = [];
  const reads = [];
  let cursor = 0;
  let effectCursor = 0;
  const previousDeps = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useMemo(fn) { return fn(); },
    useEffect(fn, deps) {
      const index = effectCursor++;
      if (!previousDeps[index] || deps.some((d, i) => d !== previousDeps[index][i])) effects.push(fn);
      previousDeps[index] = deps;
    },
  };
  const client = { from(table) { return {
    select() { return { eq(column, value) { reads.push({ table, column, value }); return { maybeSingle: async () => ({ data: loadError ? null : { content: { semesters: [{ id: '1-1', name: '大一上', courses: [] }] } }, error: loadError }) }; } }; },
    async upsert(rows) { writes.push(...rows); return { error: null }; },
  }; } };
  const context = { exports: {}, console: { error() {} }, window: { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} }, require(name) {
    if (name === 'react') return react;
    if (name === '../supabase') return { supabase: client };
    if (name === '../constants') return { INITIAL_SEMESTERS: [], DEFAULT_TARGETS: { total: 133 } };
    throw new Error(`Unexpected import: ${name}`);
  } };
  const source = readFileSync('web/src/shared/hooks/useCourseData.ts', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const render = async () => {
    cursor = 0; effectCursor = 0;
    const result = context.exports.useCourseData({ user: { id: 'test-user' } }, readOnly);
    while (effects.length) effects.shift()();
    await new Promise(resolve => setImmediate(resolve));
    return result;
  };
  return { render, writes, reads, async flushTimers() { while (timers.length) await timers.shift()(); } };
}

test('read-only preview loads the user row and never persists even after a local change', async () => {
  const h = harness(true);
  await h.render();
  const loaded = await h.render();
  assert.equal(loaded.data.semesters[0].name, '大一上');
  loaded.setData({ ...loaded.data, targets: { total: 150 } });
  await h.render();
  await h.flushTimers();
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.reads, [{ table: 'user_data', column: 'user_id', value: 'test-user' }]);
});

test('default mode retains the existing save behavior', async () => {
  const h = harness(undefined);
  await h.render(); await h.render(); await h.flushTimers();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].user_id, 'test-user');
});

test('read failure is visible and cannot write empty data in preview', async () => {
  const h = harness(true, { message: 'offline' });
  await h.render();
  const result = await h.render();
  await h.flushTimers();
  assert.match(result.loadError, /無法讀取/);
  assert.equal(h.writes.length, 0);
});
