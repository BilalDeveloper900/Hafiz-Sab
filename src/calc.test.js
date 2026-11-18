const test = require('node:test');
const assert = require('node:assert');
const { calcCones } = require('./calc');

test('180k stitches over 6 colours, 14 heads: one cone per head per colour', () => {
  // 30k stitches * 5 m/1000 = 150 m per colour per head -> fits on one 5000 m cone
  const r = calcCones({ colorStitches: Array(6).fill(30000), heads: 14 });
  assert.strictEqual(r.stitches, 180000);
  assert.strictEqual(r.threadPerHeadM, 900);
  assert.strictEqual(r.threadTotalM, 12600);
  assert.strictEqual(r.totalCones, 84);
});

test('28 heads doubles the cones', () => {
  assert.strictEqual(calcCones({ colorStitches: Array(6).fill(30000), heads: 28 }).totalCones, 168);
});

test('a heavily used colour needs more cones than a light one', () => {
  // 50 pieces: colour 1 = 160k st -> 40,000 m/head -> 8 cones; colour 2 = 20k st -> 5,000 m -> 1 cone
  const r = calcCones({ colorStitches: [160000, 20000], heads: 14, pieces: 50 });
  assert.deepStrictEqual(r.perColor.map((c) => c.conesPerHead), [8, 1]);
  assert.deepStrictEqual(r.perColor.map((c) => c.cones), [112, 14]);
  assert.strictEqual(r.totalCones, 126);
});

test('rejects bad input', () => {
  assert.throws(() => calcCones({ colorStitches: [], heads: 14 }), /Pick at least one colour/);
  assert.throws(() => calcCones({ colorStitches: [1000, 0], heads: 14 }), /Enter stitches for colour 2/);
  assert.throws(() => calcCones({ colorStitches: [1000], heads: 0 }), /heads/);
});
