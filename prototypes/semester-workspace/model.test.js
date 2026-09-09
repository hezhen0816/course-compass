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

test('registration allows overlapping choices; add/drop blocks them without mutating existing choices', async () => {
  const { canPlan, restoreMode } = await import('./model.js');
  const cost = courses.find(c=>c.id==='BA302');
  const marketing = courses.find(c=>c.id==='BA304');
  const selected = [...official,cost];
  assert.equal(canPlan(marketing, selected, 'lottery'),true);
  assert.equal(canPlan(marketing, selected, 'addDrop'),false);
  assert.equal(canPlan(cost, selected, 'lottery'),false);
  assert.equal(selected.length,7);
  assert.equal(restoreMode({getItem:()=> 'lottery'}),'lottery');
  assert.equal(restoreMode({getItem:()=> 'unexpected'}),'addDrop');
});

test('overlapping meetings receive distinct lanes; adjacent times reuse space', async () => {
  const { layoutMeetings } = await import('./model.js');
  const a={id:'a',slots:[[0,2,3]]}, b={id:'b',slots:[[0,2,2],[2,2,2]]}, c={id:'c',slots:[[0,3,2]]}, d={id:'d',slots:[[0,5,2]]};
  const events=layoutMeetings([a,b,c,d]);
  assert.equal(events.filter(e=>e.day===0 && e.start<5).every(e=>e.laneCount===3),true);
  assert.equal(events.find(e=>e.course.id==='d').laneCount,1);
  assert.equal(events.find(e=>e.day===2).laneCount,1);
  for (const x of events) for (const y of events) {
    if(x!==y && x.day===y.day && x.start<y.end && y.start<x.end) assert.notEqual(x.lane,y.lane);
  }
  assert.equal(layoutMeetings([a],a).length,1);
  const previewEvents=layoutMeetings([a],b);
  assert.equal(previewEvents.filter(e=>e.preview).length,2);
  assert.equal(previewEvents.find(e=>e.course.id==='a').laneCount,2);
});
