import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, srmPValue } from '../src/verdict.mjs';

const base = (over = {}) => ({
  experiment: { id: 1, name: 't', status: 'running', flag: 'f', controlKey: 'control' },
  metric: { name: 'm', expectedDirection: 'increase' },
  arms: { control: { n: 664, conversions: 60 }, short: { n: 736, conversions: 109 } },
  inference: { short: { lift: 0.639, ciLow: 0.152, ciHigh: 1.126, chanceToWin: 0.995 } },
  allocation: { control: 0.5, short: 0.5 }, srmPValueFromFlagsmith: null, excludedIdentities: 0, ...over,
});

test('case 1: 99.5% and interval clear of zero -> SHIP the variant', () => {
  const v = decide(base());
  assert.equal(v.decision, 'SHIP'); assert.equal(v.winner, 'short'); assert.equal(v.rolloutDecision, 'variant');
});
test('case 2: interval crosses zero -> KEEP_RUNNING even at 84%', () => {
  const v = decide(base({ arms: { control: { n: 201, conversions: 39 }, a: { n: 221, conversions: 46 } }, inference: { a: { lift: 0.12, ciLow: -0.05, ciHigh: 0.29, chanceToWin: 0.84 } }, allocation: { control: 0.5, a: 0.5 } }));
  assert.equal(v.decision, 'KEEP_RUNNING'); assert.ok(v.moreIdentitiesEstimate > 0);
});
test('case 2b: 96% but interval still touches zero -> KEEP_RUNNING (both conditions required)', () => {
  const v = decide(base({ inference: { short: { lift: 0.2, ciLow: -0.01, ciHigh: 0.41, chanceToWin: 0.96 } } }));
  assert.equal(v.decision, 'KEEP_RUNNING');
});
test('case 3: sample ratio mismatch -> STOP before any win is read', () => {
  const v = decide(base({ arms: { control: { n: 912, conversions: 60 }, short: { n: 640, conversions: 109 } } }));
  assert.equal(v.decision, 'STOP');
});
test('Flagsmith srm_p_value takes precedence over the cross-check', () => {
  assert.equal(decide(base({ srmPValueFromFlagsmith: 0.0001 })).decision, 'STOP');
});
test('below the collecting-data floor -> KEEP_RUNNING, whatever the chance says', () => {
  const v = decide(base({ arms: { control: { n: 49, conversions: 9 }, short: { n: 60, conversions: 30 } } }));
  assert.equal(v.decision, 'KEEP_RUNNING'); assert.equal(v.collecting, true);
  assert.equal(decide(base({ arms: { control: { n: 200, conversions: 4 }, short: { n: 200, conversions: 30 } } })).collecting, true);
});
test('too many quarantined identities -> STOP', () => {
  assert.equal(decide(base({ excludedIdentities: 40 })).decision, 'STOP');
});
test('variation clearly loses -> SHIP control', () => {
  const v = decide(base({ inference: { short: { lift: -0.3, ciLow: -0.5, ciHigh: -0.1, chanceToWin: 0.01 } } }));
  assert.equal(v.decision, 'SHIP'); assert.equal(v.winner, 'control'); assert.equal(v.rolloutDecision, 'control');
});
test('an experiment that is not running is never decided', () => {
  assert.equal(decide(base({ experiment: { id: 1, status: 'completed', controlKey: 'control' } })).decision, 'NOT_RUNNING');
});
test('chi-square p-value matches known values', () => {
  assert.ok(Math.abs(srmPValue({ a: 500, b: 500 }, { a: 0.5, b: 0.5 }) - 1) < 1e-9);
  assert.ok(Math.abs(srmPValue({ a: 9120, b: 6400 }, { a: 0.5, b: 0.5 })) < 1e-50);
  assert.ok(Math.abs(srmPValue({ a: 530, b: 470 }, { a: 0.5, b: 0.5 }) - 0.0578) < 0.001); // chi2 = 3.6, df = 1
});
