// Offline smoke test for the pure pieces (no browser, no live assets):
//  - param parsing maps the Habbo query contract correctly
//  - the encoder produces a valid PNG (1 frame) and a valid APNG (n frames)

import assert from 'assert';
import { parseAvatarParams } from '../src/params.mjs';
import { encodeFrames } from '../src/apng.mjs';

// --- params ------------------------------------------------------------------
const p = parseAvatarParams({
    figure: 'hd-180-1.ch-255-66',
    action: 'wlk,wav,drk=5',
    gesture: 'sml',
    direction: '4',
    head_direction: '3',
    headonly: '1',
    dance: '2',
    effect: '7',
    size: 'l',
    frame_num: '3'
});

assert.equal(p.figure, 'hd-180-1.ch-255-66');
assert.equal(p.posture, 'mv', 'wlk -> mv');
assert.deepEqual(p.expressions, ['wave'], 'wav -> wave');
assert.deepEqual(p.handItem, { action: 'usei', id: '5' }, 'drk=5 -> use item 5');
assert.equal(p.gesture, 'sml');
assert.equal(p.direction, 4);
assert.equal(p.headDirection, 3);
assert.equal(p.setType, 'head', 'headonly=1 -> head');
assert.equal(p.dance, 2);
assert.equal(p.effect, 7);
assert.equal(p.scale, 'h');
assert.equal(p.postScale, 2, 'size=l -> 2x');
assert.equal(p.frameNum, 3);

// defaults + clamping
const d = parseAvatarParams({ figure: 'hd-180-1', direction: '9', dance: '99' });
assert.equal(d.posture, 'std');
assert.equal(d.gesture, null, 'default gesture std -> none');
assert.equal(d.direction, 1, 'direction 9 wraps to 1');
assert.equal(d.dance, 4, 'dance clamps to 4');
assert.equal(d.scale, 'h');
assert.equal(d.postScale, 1);

// carry variant
const c = parseAvatarParams({ figure: 'x', action: 'sit,crr=99' });
assert.equal(c.posture, 'sit');
assert.deepEqual(c.handItem, { action: 'cri', id: '99' });

// missing figure -> throws
assert.throws(() => parseAvatarParams({}), /figure/);

console.log('  params: OK');

// --- input validation (hardening) -------------------------------------------
// figure charset + length
assert.throws(() => parseAvatarParams({ figure: 'hd-180-1<script>' }), /invalid characters/);
assert.throws(() => parseAvatarParams({ figure: 'a'.repeat(600) }), /too long/);
assert.throws(() => parseAvatarParams({ figure: 'hd 180 1' }), /invalid characters/); // spaces
// action charset + length + token count
assert.throws(() => parseAvatarParams({ figure: 'hd-180-1', action: 'wlk;rm -rf' }), /invalid characters/);
assert.throws(() => parseAvatarParams({ figure: 'hd-180-1', action: 'a'.repeat(300) }), /too long/);
assert.throws(() => parseAvatarParams({ figure: 'hd-180-1', action: Array(30).fill('std').join(',') }), /too many/);
// valid inputs still pass
assert.ok(parseAvatarParams({ figure: 'hd-180-1.ch-255-66', action: 'wlk,drk=1' }));

console.log('  validation: OK');

// --- encoder -----------------------------------------------------------------
const W = 4;
const H = 4;
const solid = (r, g, b, a) => {
    const buf = Buffer.alloc(W * H * 4);

    for (let i = 0; i < W * H; i++) {
        buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = a;
    }

    return buf;
};

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const hasChunk = (buf, name) => buf.includes(Buffer.from(name, 'ascii'));

// single frame -> PNG (no acTL)
const png = encodeFrames({ frames: [solid(255, 0, 0, 255)], width: W, height: H, delays: [0], postScale: 1 });
assert.ok(png.subarray(0, 8).equals(PNG_SIG), 'PNG signature');
assert.ok(hasChunk(png, 'IHDR'), 'IHDR present');
assert.ok(!hasChunk(png, 'acTL'), 'single frame must NOT be animated');

// multi frame -> APNG (acTL + fcTL)
const apng = encodeFrames({
    frames: [solid(255, 0, 0, 255), solid(0, 255, 0, 255), solid(0, 0, 255, 255)],
    width: W,
    height: H,
    delays: [40, 40, 40],
    postScale: 1
});
assert.ok(apng.subarray(0, 8).equals(PNG_SIG), 'APNG signature');
assert.ok(hasChunk(apng, 'acTL'), 'acTL present -> animated');
assert.ok(hasChunk(apng, 'fcTL'), 'fcTL present');

// 2x upscale changes dimensions (IHDR width byte should reflect W*2)
const big = encodeFrames({ frames: [solid(1, 2, 3, 255)], width: W, height: H, delays: [0], postScale: 2 });
// IHDR width is 4 bytes big-endian at offset 16
assert.equal(big.readUInt32BE(16), W * 2, '2x upscale width');
assert.equal(big.readUInt32BE(20), H * 2, '2x upscale height');

console.log('  encoder: OK');
console.log('smoke: ALL PASSED');
