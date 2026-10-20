#include <stdint.h>
/* PS2 SPU-ADPCM decoder: decodes from `data` until an end-flag block or `max_blocks`. Returns blocks consumed;
   *loop_block = index of first block with the loop-start flag, or -1. */
static const int F0[5] = {0, 60, 115, 98, 122};
static const int F1[5] = {0, 0, -52, -55, -60};
int spu_decode(const uint8_t *data, int max_blocks, int16_t *out, int *loop_block) {
  int h1 = 0, h2 = 0, n = 0;
  *loop_block = -1;
  while (n < max_blocks) {
    const uint8_t *p = data + n * 16;
    int shift = p[0] & 15, filt = (p[0] >> 4) & 7, flags = p[1];
    if (filt > 4) filt = 4;
    if (shift > 12) shift = 9;
    if ((flags & 4) && *loop_block < 0) *loop_block = n;
    for (int i = 0; i < 14; i++) {
      for (int k = 0; k < 2; k++) {
        int nib = k ? (p[2 + i] >> 4) : (p[2 + i] & 15);
        int s = nib >= 8 ? nib - 16 : nib;
        int v = ((s << 12) >> shift) + ((h1 * F0[filt] + h2 * F1[filt] + 32) >> 6);
        if (v > 32767) v = 32767;
        if (v < -32768) v = -32768;
        out[n * 28 + i * 2 + k] = (int16_t)v;
        h2 = h1; h1 = v;
      }
    }
    n++;
    if (flags & 1) break;
  }
  return n;
}
