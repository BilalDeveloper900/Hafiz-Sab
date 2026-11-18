// ALL thread/cone logic lives here. Pure function: no DB, no UI.
// Change this file after meeting the client; the rest of the app stays the same.

// PLACEHOLDERS: confirm with the client before trusting any number.
const DEFAULTS = {
  metersPer1000Stitches: 5, // thread used per 1,000 stitches, per head
  coneLengthM: 5000, // thread on one cone
};

// colorStitches: stitches for each colour of the design, in needle order (the machine reports these).
function calcCones({
  colorStitches,
  heads,
  pieces = 1,
  metersPer1000Stitches = DEFAULTS.metersPer1000Stitches,
  coneLengthM = DEFAULTS.coneLengthM,
}) {
  if (!Array.isArray(colorStitches) || !colorStitches.length) throw new Error('Pick at least one colour');
  for (const [k, v] of Object.entries({ heads, pieces, metersPer1000Stitches, coneLengthM, ...colorStitches })) {
    if (!(Number(v) > 0)) throw new Error(isNaN(k) ? `${k} must be a positive number` : `Enter stitches for colour ${Number(k) + 1}`);
  }
  const perColor = colorStitches.map((stitches) => {
    const threadPerHeadM = (stitches / 1000) * metersPer1000Stitches * pieces;
    // every head needs its own cone of this colour, so at least 1 cone per head
    const conesPerHead = Math.ceil(threadPerHeadM / coneLengthM);
    return { stitches, threadPerHeadM: Math.round(threadPerHeadM), conesPerHead, cones: conesPerHead * heads };
  });
  const threadPerHeadM = perColor.reduce((s, c) => s + c.threadPerHeadM, 0);
  return {
    stitches: colorStitches.reduce((s, n) => s + Number(n), 0),
    threadPerHeadM,
    threadTotalM: threadPerHeadM * heads,
    totalCones: perColor.reduce((s, c) => s + c.cones, 0),
    perColor,
  };
}

module.exports = { calcCones, DEFAULTS };
