"""Render FFX sound sequences (SE entries and BGM music) to audio using the disc's own sound banks.

Pipeline: sndseq (events) -> per-track state machine (program, volume, expression, pan, pitch bend, notes) -> one SPU
voice per note (ADPCM sample, pitch from key/unity key, ADSR from the region record, gain/pan/pitch automation) mixed
to stereo float at 48 kHz. The voice maths is in spu_dec.c (compile: gcc -O2 -shared -o spu_dec.dll spu_dec.c).
"""
import ctypes
import os
import struct
import wave

import numpy as np

import sndseq as sq

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FILES = os.path.join(ROOT, "data", "raw", "files")
RATE = 48000
CTRL = 200  # output samples per control step (240 Hz = the driver's tick rate)
TICK_SE = 1 / 240.0
# samples play at 44.1 kHz at their unity key (fitted: tonal regions across banks land on equal temperament)
SAMPLE_BASE_SEMIS = 12 * float(np.log2(44100 / RATE))

_dll = ctypes.CDLL(os.path.join(HERE, "spu_dec.dll"))
_dll.spu_decode.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)]
_dll.spu_decode.restype = ctypes.c_int
_dll.spu_voice.argtypes = [
    ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_double, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    ctypes.c_float, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
    ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p,
]
_dll.spu_voice.restype = ctypes.c_int


def _ptr(a):
    return a.ctypes.data


class Region:
    __slots__ = ("sample_off", "adsr1", "adsr2", "fine", "unity", "key_high", "key_low", "atten", "pan", "first", "last")


class WD:
    """One 'WD' sound bank: instruments (programs) made of key-split regions, plus the ADPCM sample area."""

    def __init__(self, data: bytes):
        self.data = data
        self.id = struct.unpack_from("<H", data, 2)[0]
        n_inst, n_reg = struct.unpack_from("<II", data, 8)
        offs = struct.unpack_from(f"<{n_inst}I", data, 0x20)
        offs = [o for o in offs if o != 0xFFFFFFFF]
        self.samp_base = offs[0] + n_reg * 0x20
        self.instruments = []
        bounds = offs[1:] + [self.samp_base]
        for o, nxt in zip(offs, bounds):
            regs = []
            for k in range(0, nxt - o, 0x20):
                r = Region()
                rec = data[o + k : o + k + 0x20]
                if len(rec) < 0x20:
                    break
                r.first, r.last = rec[1] & 1, (rec[1] >> 1) & 1
                r.sample_off = struct.unpack_from("<I", rec, 4)[0] & 0xFFFFFFF0
                r.adsr1, r.adsr2 = struct.unpack_from("<HH", rec, 0xC)
                r.fine = rec[0x12]
                r.unity = (0x3A - rec[0x13]) & 0xFF
                r.key_high = rec[0x14]
                r.atten = rec[0x16] / 127.0
                r.pan = rec[0x17]
                regs.append(r)
            prev = None
            for r in regs:
                if r.first or prev is None:
                    r.key_low = 0
                elif r.key_high == prev.key_high:
                    r.key_low = prev.key_low
                else:
                    r.key_low = prev.key_high + 1
                if r.last:
                    r.key_high = 0x7F
                prev = r
            self.instruments.append(regs)
        self._cache = {}

    def region(self, program: int, key: int):
        if program >= len(self.instruments):
            return None
        regs = self.instruments[program]
        for r in regs:
            if r.key_low <= key <= r.key_high:
                return r
        return regs[-1] if regs else None

    def sample(self, r: Region):
        """-> (pcm int16 array, loop start sample or -1)."""
        c = self._cache.get(r.sample_off)
        if c is None:
            off = self.samp_base + r.sample_off
            nblk = (len(self.data) - off) // 16
            out = np.zeros(max(nblk, 1) * 28, dtype=np.int16)
            lb = ctypes.c_int(-1)
            ef = ctypes.c_int(0)
            n = _dll.spu_decode(self.data[off:], nblk, _ptr(out), ctypes.byref(lb), ctypes.byref(ef))
            pcm = out[: n * 28].copy()
            loop = -1
            if ef.value & 2:  # repeat flag on the end block
                loop = max(lb.value, 0) * 28
            c = (pcm, loop)
            self._cache[r.sample_off] = c
        return c


_banks_index = None


def bank(wave_id: int) -> WD:
    global _banks_index
    if _banks_index is None:
        b = open(os.path.join(FILES, "00470.bin"), "rb").read()
        _banks_index = {}
        pos = 0
        while pos + 32 <= len(b):
            if b[pos : pos + 2] == b"WD":
                bid, size, cnt, cnt2 = struct.unpack_from("<HIII", b, pos + 2)
                if 0 < cnt <= cnt2 < 4000 and 0 < size < 20_000_000:
                    _banks_index.setdefault(bid, (pos, size))
            pos += 0x800
        _banks_index["data"] = b
    if isinstance(_banks_index[wave_id], tuple):
        pos, size = _banks_index[wave_id]
        _banks_index[wave_id] = WD(_banks_index["data"][pos : pos + size])
    return _banks_index[wave_id]


class Curve:
    """Piecewise-linear automation over time (seconds)."""

    def __init__(self, v0):
        self.t = [0.0]
        self.v = [float(v0)]

    def value(self, t):
        return float(np.interp(t, self.t, self.v))

    def set(self, t, v):
        self._add(t, self.value(t))
        self._add(t, v)

    def slide(self, t, t_end, v):
        self._add(t, self.value(t))
        self._add(max(t_end, t), v)

    def _add(self, t, v):
        if t < self.t[-1]:  # out-of-order edit: drop later points
            while len(self.t) > 1 and self.t[-1] > t:
                self.t.pop()
                self.v.pop()
        self.t.append(float(t))
        self.v.append(float(v))

    def sample(self, n):
        ts = np.arange(n) * (CTRL / RATE)
        return np.interp(ts, self.t, self.v).astype(np.float32)


def expand(ev, max_ticks):
    """Interpret loop opcodes (04 start, 05 end(count), 06 forever) -> ([(tick, op, args)], loops_forever)."""
    out = []
    tick = 0
    i = 0
    stack = []  # [event index after 04, passes done]
    steps = 0
    forever = False
    while i < len(ev) and tick <= max_ticks and steps < 200000:
        steps += 1
        dt, op, args = ev[i]
        tick += dt
        if op == sq.LOOP_START:
            stack.append([i + 1, 0])
        elif op == sq.LOOP_END:
            if stack:
                stack[-1][1] += 1
                count = args[0] or 256
                if stack[-1][1] != count:
                    i = stack[-1][0]
                    continue
                stack.pop()
        elif op == sq.LOOP_FOREVER:
            forever = True
            if stack:
                i = stack[-1][0]
                continue
            break
        out.append((tick, op, args))
        if op == sq.END:
            break
        i += 1
    return out, forever


class Voice:
    __slots__ = ("t_on", "t_off", "key", "vel", "program", "slot")


def _sgn(v):
    return v - 256 if v > 127 else v


def render(tracks, wd_for_slot, tick_time, max_seconds, default_slot=0, bend_range=2.0):
    """tracks: expanded event lists; wd_for_slot(slot)->WD or None; tick_time(tick)->seconds.
    -> (stereo float array [n,2], voice count)."""
    nctrl = int(max_seconds * RATE / CTRL) + 2
    out_len = nctrl * CTRL
    outL = np.zeros(out_len, dtype=np.float32)
    outR = np.zeros(out_len, dtype=np.float32)
    nvoices = 0
    for ev in tracks:
        vol, expr, pan, pitch = Curve(127), Curve(127), Curve(64), Curve(0)
        program, slot, key, vel = 0, default_slot, 60, 100
        bend, brange = 0.0, bend_range
        held, voices, pending_off = [], [], []
        sustain = False
        end_t = None

        def key_off(k, t):
            for v in reversed(held):
                if v.key == k and v.t_off is None:
                    if sustain:
                        pending_off.append(v)
                    else:
                        v.t_off = t
                    return

        for tick, op, a in ev:
            t = tick_time(tick)
            if op in (sq.NOTE_KEYVEL, sq.NOTE_KEY, sq.NOTE_VEL, sq.NOTE_PREV):
                if op == sq.NOTE_KEYVEL:
                    key, vel = a
                elif op == sq.NOTE_KEY:
                    key = a[0]
                elif op == sq.NOTE_VEL:
                    vel = a[0]
                v = Voice()
                v.t_on, v.t_off, v.key, v.vel, v.program, v.slot = t, None, key, vel, program, slot
                voices.append(v)
                held.append(v)
            elif op in (sq.OFF_PREV, sq.OFF_SKIP):
                key_off(key, t)
            elif op in (sq.OFF_KEY, sq.OFF_KEY2):
                key = a[0]
                key_off(key, t)
            elif op == sq.PROGRAM:
                program = a[0]
            elif op == sq.BANK_PROGRAM:
                slot, program = a
            elif op == sq.VOL:
                vol.set(t, a[0])
            elif op == sq.VOL_SLIDE:
                vol.slide(t, t + _dur(tick_time, tick, a[0]), _sgn(a[1]))
            elif op == sq.EXPR:
                expr.set(t, a[0])
            elif op == sq.EXPR_SLIDE:
                expr.slide(t, t + _dur(tick_time, tick, a[0]), _sgn(a[1]))
            elif op == sq.PAN:
                pan.set(t, a[0])
            elif op == sq.PAN_SLIDE:
                pan.slide(t, t + _dur(tick_time, tick, a[0]), _sgn(a[1]) + 64)
            elif op == sq.BEND:
                bend = (a[0] + a[1] * 0x80 - 0x2000) / 8192.0 * brange
                pitch.set(t, bend)
            elif op == sq.BEND_RANGE:
                brange = float(a[0]) if a[0] else bend_range
            elif op == sq.PITCH_SLIDE:
                pitch.slide(t, t + _dur(tick_time, tick, a[0]), bend + _sgn(a[1]))
            elif op == sq.SUSTAIN:
                if a[0]:
                    sustain = True
                else:
                    sustain = False
                    for v in pending_off:
                        if v.t_off is None:
                            v.t_off = t
                    pending_off.clear()
            elif op == sq.END:
                end_t = t
        for v in voices:
            if v.t_off is None and end_t is not None:
                v.t_off = end_t
        gain = np.ascontiguousarray((vol.sample(nctrl) / 127.0) * (expr.sample(nctrl) / 127.0))
        panv = np.ascontiguousarray(np.clip(pan.sample(nctrl) / 127.0, 0.0, 1.0))
        semis = pitch.sample(nctrl)
        for v in voices:
            wd = wd_for_slot(v.slot)
            r = wd.region(v.program, v.key) if wd else None
            if r is None:
                continue
            pcm, loop = wd.sample(r)
            start = int(v.t_on * RATE)
            if len(pcm) < 2 or start >= out_len:
                continue
            base_semis = v.key - r.unity + (r.fine / 256.0 - 0.5) + SAMPLE_BASE_SEMIS
            ratio = np.ascontiguousarray((2.0 ** ((semis + base_semis) / 12.0)).astype(np.float32))
            ko = int(v.t_off * RATE) if v.t_off is not None else -1
            _dll.spu_voice(
                _ptr(pcm), len(pcm), loop, 1.0, r.adsr1, r.adsr2, ko,
                float(v.vel / 127.0 * r.atten), _ptr(gain), _ptr(panv), _ptr(ratio),
                nctrl, CTRL, start, out_len, _ptr(outL), _ptr(outR),
            )
            nvoices += 1
    return np.stack([outL, outR], axis=1), nvoices


def _dur(tick_time, tick, dur):
    return tick_time(tick + dur) - tick_time(tick)


def trim(audio, thresh=1e-4, tail=0.02):
    mag = np.abs(audio).max(axis=1)
    idx = np.where(mag > thresh)[0]
    if len(idx) == 0:
        return audio[:1]
    return audio[idx[0] : min(len(audio), idx[-1] + int(tail * RATE) + 1)]


def to_int16(audio, gain):
    return (np.clip(audio * gain, -1, 1) * 32767).astype(np.int16)


def write_wav(path, audio_i16, rate=RATE):
    with wave.open(path, "wb") as w:
        w.setnchannels(audio_i16.shape[1])
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(audio_i16.tobytes())


def render_se(b: bytes, entry_off: int, max_seconds=6.0):
    """Render one SE entry (SeBlock / SEP). -> (stereo float, info dict)."""
    e = sq.se_entry(b, entry_off)
    max_ticks = int(max_seconds * 240)
    tracks, forever = [], False
    for p, end in e["tracks"]:
        ev, f = expand(sq.parse_track(b, p, end), max_ticks)
        tracks.append(ev)
        forever = forever or f
    primary = bank(e["wave"])

    def pick(slot):
        # SeBlock entries address the system banks by slot (0, 1); SEPs of other waves use their own bank
        if slot == 0:
            return primary
        try:
            return bank(slot)
        except KeyError:
            return primary

    audio, n = render(tracks, pick, lambda t: t * TICK_SE, max_seconds)
    return trim(audio), dict(wave=e["wave"], tracks=len(tracks), forever=forever, voices=n)


def tempo_map(tracks, ppqn=48, default_bpm=120.0):
    """Global tempo from every track's 0x08 (set) / 0x09 (slide: ticks, target) events -> tick_time(tick)."""
    pts = {}
    for ev in tracks:
        for tick, op, a in ev:
            if op == sq.TEMPO:
                pts[tick] = float(a[0])
            elif op == sq.TEMPO_SLIDE:
                pts[tick + (a[0] or 256)] = float(a[1])
    ticks = [0] + sorted(pts)
    bpms = [pts.get(0, default_bpm)] + [pts[t] for t in sorted(pts) if t != 0]
    ticks = sorted(set(ticks))
    bpm_at = [pts.get(t, default_bpm) for t in ticks]
    secs = [0.0]
    for i in range(1, len(ticks)):
        secs.append(secs[-1] + (ticks[i] - ticks[i - 1]) * 60.0 / (max(bpm_at[i - 1], 1.0) * ppqn))

    def tick_time(t):
        i = max(0, int(np.searchsorted(ticks, t, side="right")) - 1)
        return secs[i] + (t - ticks[i]) * 60.0 / (max(bpm_at[i], 1.0) * ppqn)

    return tick_time


def render_bgm(b: bytes, seq: dict, max_seconds=400.0, tail=2.5):
    """Render one 'BGM ' sequence up to its loop end marker (0x03). -> (stereo float, info dict).
    The conductor track marks the loop with 0x02 (start) and 0x03 (end); info has loop_start / loop_end seconds
    (None when the music does not loop)."""
    wd = bank(seq["wd"])
    raw = [sq.parse_track(b, p, e) for p, e in seq["tracks"]]
    flat = []
    for ev in raw:
        t, out = 0, []
        for dt, op, a in ev:
            t += dt
            out.append((t, op, a))
        flat.append(out)
    tt = tempo_map(flat, seq["ppqn"])
    starts = [t for ev in flat for t, op, _ in ev if op == 2]
    ends = [t for ev in flat for t, op, _ in ev if op == 3]
    end_tick = max((ev[-1][0] if ev else 0) for ev in flat)  # events after the 0x03 marker (if any) are the outro
    loop_s = tt(min(starts)) if starts and ends else None
    loop_e = tt(min(ends)) if ends else None
    seconds = min(max_seconds, tt(end_tick) + tail)
    audio, n = render(flat, lambda slot: wd, tt, seconds)
    audio = audio[: int(seconds * RATE)]
    return audio, dict(wd=seq["wd"], tracks=len(flat), voices=n, loop_start=loop_s, loop_end=loop_e, seconds=len(audio) / RATE)


