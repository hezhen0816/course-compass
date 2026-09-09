import test from 'node:test';
import assert from 'node:assert/strict';
import { conflicts, courses, official, restorePlans, defaultPlans } from './model.js';

test('detects an overlap in any meeting while allowing adjacent periods and other days', () => {
  const existing = { id: 'existing', slots: [[0,3,2], [2,4,1]] };
  assert.deepEqual(conflicts({id:'overlap',slots:[[2,4,2]]},[existing]),[existing]);
  assert.deepEqual(conflicts({id:'adjacent',slots:[[0,5,1]]},[existing]),[]);
  assert.deepEqual(conflicts({id:'different-day',slots:[[1,3,2]]},[existing]),[]);
  assert.deepEqual(conflicts(existing,[existing]),[]);
});
test('sample AI course conflicts while database course fits', () => {
  assert.deepEqual(conflicts(courses.find(c=>c.id==='CS302'),official).map(c=>c.id),['CS201']);
  assert.deepEqual(conflicts(courses.find(c=>c.id==='CS301'),official),[]);
});
test('restores an intentionally empty plan and ignores unknown or official IDs', () => {
  assert.deepEqual(restorePlans({getItem:()=> '[]'}),[]);
  assert.deepEqual(restorePlans({getItem:()=> '["CS201","CS301","CS301","unknown"]'}),['CS301']);
  assert.deepEqual(restorePlans({getItem:()=> '{broken'}),defaultPlans);
  assert.deepEqual(restorePlans({getItem:()=> {throw new Error('denied');}}),defaultPlans);
});
