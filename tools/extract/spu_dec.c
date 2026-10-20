/* PS2 SPU(2) helpers: ADPCM decode and a single-voice renderer (pitch, ADSR, looping, gain/pan automation). */
#include <stdint.h>
#include <math.h>

static const int F0[5] = {0, 60, 115, 98, 122};
static const int F1[5] = {0, 0, -52, -55, -60};

/* Decode blocks from `data` until an end-flag block or `max_blocks`. Returns blocks consumed.
   *loop_block = first block with the loop-start flag (-1 none); *end_flags = flags of the last block. */
int spu_decode(const uint8_t *data, int max_blocks, int16_t *out, int *loop_block, int *end_flags) {
  int h1 = 0, h2 = 0, n = 0;
  *loop_block = -1;
  *end_flags = 0;
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
    *end_flags = flags;
    if (flags & 1) break;
  }
  return n;
}

/* SPU envelope step (nocash / DuckStation formulation) */
static void env_step(int *env, int *cnt, int shift, int step_raw, int decreasing, int expo) {
  int step = decreasing ? (-8 + step_raw) : (7 - step_raw);
  int cycles = 1 << (shift > 11 ? shift - 11 : 0);
  if (shift < 11) step <<= (11 - shift);
  if (expo) {
    if (decreasing) step = (step * *env) >> 15;
    else if (*env > 0x6000) cycles *= 4;
  }
  if (++*cnt >= cycles) {
    *cnt = 0;
    int e = *env + step;
    if (e < 0) e = 0;
    if (e > 0x7fff) e = 0x7fff;
    *env = e;
  }
}

/* Render one voice, adding into outL/outR (float, absolute timeline).
   step: source samples per output sample. loop_start<0 => one shot; otherwise loops [loop_start, n).
   keyoff: absolute output sample at which release starts (-1 never). gain/pan: control curves sampled every
   ctrl_rate output samples on the absolute timeline (pan 0..1). Returns the output sample where the voice ended. */
int spu_voice(const int16_t *pcm, int n, int loop_start, double step, int a1, int a2, int keyoff,
              float base_gain, const float *gain, const float *pan, const float *ratio, int nctrl, int ctrl_rate,
              int out_start, int out_len, float *outL, float *outR) {
  double pos = 0;
  int env = 0, cnt = 0, phase = 0; /* 0 attack 1 decay 2 sustain 3 release */
  int sus_level = ((a1 & 15) + 1) * 0x800;
  int released = 0;
  int t;
  for (t = out_start; t < out_len; t++) {
    if (!released && keyoff >= 0 && t >= keyoff) { released = 1; phase = 3; cnt = 0; }
    switch (phase) {
      case 0:
        env_step(&env, &cnt, (a1 >> 10) & 31, (a1 >> 8) & 3, 0, (a1 >> 15) & 1);
        if (env >= 0x7fff) { phase = 1; cnt = 0; }
        break;
      case 1:
        env_step(&env, &cnt, (a1 >> 4) & 15, 0, 1, 1);
        if (env <= sus_level) phase = 2;
        break;
      case 2:
        env_step(&env, &cnt, (a2 >> 8) & 31, (a2 >> 6) & 3, (a2 >> 14) & 1, (a2 >> 15) & 1);
        break;
      default:
        env_step(&env, &cnt, a2 & 31, 0, 1, (a2 >> 5) & 1);
        if (env == 0) return t;
    }
    int ip = (int)pos;
    if (ip >= n) {
      if (loop_start >= 0) { pos = loop_start + (pos - n); ip = (int)pos; if (ip >= n) ip = loop_start; }
      else return t;
    }
    double fr = pos - ip;
    int i1 = ip + 1;
    if (i1 >= n) i1 = loop_start >= 0 ? loop_start : ip;
    float s = (float)((1.0 - fr) * pcm[ip] + fr * pcm[i1]) * (1.0f / 32768.0f);
    int ci = t / ctrl_rate;
    if (ci >= nctrl) ci = nctrl - 1;
    float g = base_gain * gain[ci] * s * (float)env * (1.0f / 32767.0f);
    float p = pan[ci];
    outL[t] += g * cosf(p * 1.5707963f);
    outR[t] += g * sinf(p * 1.5707963f);
    pos += step * ratio[ci];
  }
  return t;
}
