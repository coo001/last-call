import test from 'node:test';
import assert from 'node:assert/strict';
import { collapse } from '../src/cleanup.mjs';

const src = `import { pick } from '../lib/pick.mjs';

export async function inviteButton(flags, userId) {
  const flag = await flags.getExperimentFlag('invite_cta', userId);
  const label = pick(flag, {
    control: 'Invite your teammates to this trip',
    short: 'Send invite, it takes (10s)',
  });
  return \`<button>\${label}</button>\`;
}
`;
test('keeps only the winning entry and removes the flag read and the import', () => {
  const r = collapse(src, 'invite_cta', 'short');
  assert.ok(r.changed);
  assert.match(r.source, /const label = 'Send invite, it takes \(10s\)';/);
  assert.doesNotMatch(r.source, /Invite your teammates/);
  assert.doesNotMatch(r.source, /getExperimentFlag|pick/);
  assert.deepEqual(r.leftoverLines, []);
});
test('control can win too', () => {
  assert.match(collapse(src, 'invite_cta', 'control').source, /const label = 'Invite your teammates to this trip';/);
});
test('other flags in the same file are untouched', () => {
  const two = src + `export async function other(flags, id) {\n  const f2 = await flags.getExperimentFlag('pricing_headline', id);\n  return pick(f2, { control: 'a', annual_first: 'b' });\n}\n`;
  const r = collapse(two, 'invite_cta', 'short');
  assert.match(r.source, /pricing_headline/); assert.match(r.source, /import \{ pick \}/);
});
test('unknown winner changes nothing and says so', () => {
  const r = collapse(src, 'invite_cta', 'nope');
  assert.equal(r.changed, false); assert.equal(r.source, src); assert.equal(r.notes.length, 1);
});
test('a reference it does not understand is reported, not rewritten', () => {
  const odd = `if (flags.raw('invite_cta') === 'short') { a(); } else { b(); }\n`;
  const r = collapse(odd, 'invite_cta', 'short');
  assert.equal(r.changed, false); assert.deepEqual(r.leftoverLines, [1]);
});
