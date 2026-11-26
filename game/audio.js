/* ============================================================
   音效引擎 · 全部由 Web Audio 实时合成，不加载任何音频文件
   ============================================================ */
(function (root) {
  'use strict';

  const NOTE = {
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880,
    C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98
  };

  const Engine = {
    ctx: null,
    master: null,
    verb: null,
    enabled: true,
    volume: 0.55,

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      }
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) { this.enabled = false; return null; }
      const ctx = new AC();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;

      // 极简混响：短脉冲响应 + 湿声
      const conv = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 0.9);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
      }
      conv.buffer = buf;
      const wet = ctx.createGain();
      wet.gain.value = 0.17;
      conv.connect(wet);
      wet.connect(this.master);

      this.verb = conv;
      this.master.connect(ctx.destination);
      return ctx;
    },

    setEnabled(on) {
      this.enabled = on;
      if (this.master) {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.02);
      }
      if (on) this.init();
    },

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.02);
    },

    /** 一个带包络的音 */
    tone(freq, opts) {
      if (!this.enabled) return;
      const ctx = this.init();
      if (!ctx) return;
      const o = Object.assign({
        type: 'sine', dur: 0.16, gain: 0.16, attack: 0.005, delay: 0,
        slideTo: null, verb: 0, filter: null
      }, opts || {});

      const t0 = ctx.currentTime + o.delay;
      const osc = ctx.createOscillator();
      osc.type = o.type;
      osc.frequency.setValueAtTime(freq, t0);
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t0 + o.dur);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.gain, t0 + o.attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

      let node = osc;
      if (o.filter) {
        const f = ctx.createBiquadFilter();
        f.type = o.filter.type || 'lowpass';
        f.frequency.value = o.filter.freq || 2000;
        f.Q.value = o.filter.q || 1;
        node.connect(f);
        node = f;
      }
      node.connect(g);
      g.connect(this.master);
      if (o.verb && this.verb) {
        const send = ctx.createGain();
        send.gain.value = o.verb;
        g.connect(send);
        send.connect(this.verb);
      }
      osc.start(t0);
      osc.stop(t0 + o.dur + 0.05);
    },

    /** 短噪声（纸张感） */
    noise(opts) {
      if (!this.enabled) return;
      const ctx = this.init();
      if (!ctx) return;
      const o = Object.assign({ dur: 0.05, gain: 0.05, freq: 2600, q: 0.9, delay: 0 }, opts || {});
      const t0 = ctx.currentTime + o.delay;
      const len = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = o.freq;
      bp.Q.value = o.q;
      const g = ctx.createGain();
      g.gain.value = o.gain;
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(t0);
    },

    // ---------- 具体音效 ----------
    place() {
      this.tone(NOTE.E5, { type: 'triangle', dur: 0.09, gain: 0.14, slideTo: NOTE.D5 });
      this.noise({ dur: 0.045, gain: 0.035, freq: 3200 });
    },
    note() {
      this.tone(NOTE.G6, { type: 'sine', dur: 0.05, gain: 0.05 });
      this.noise({ dur: 0.03, gain: 0.02, freq: 4200 });
    },
    select() {
      this.tone(1200, { type: 'sine', dur: 0.03, gain: 0.03 });
    },
    erase() {
      this.tone(NOTE.D5, { type: 'triangle', dur: 0.1, gain: 0.09, slideTo: NOTE.C5 * 0.85 });
    },
    error() {
      this.tone(146.83, { type: 'triangle', dur: 0.26, gain: 0.19, slideTo: 110 });
      this.tone(155.56, { type: 'sine', dur: 0.24, gain: 0.1, slideTo: 116 });
      this.noise({ dur: 0.09, gain: 0.05, freq: 480 });
    },
    unit() {
      this.tone(NOTE.C6, { type: 'triangle', dur: 0.22, gain: 0.1, verb: 0.5 });
      this.tone(NOTE.G6, { type: 'sine', dur: 0.3, gain: 0.06, delay: 0.05, verb: 0.7 });
    },
    hint() {
      this.tone(NOTE.A5, { type: 'sine', dur: 0.14, gain: 0.09, slideTo: NOTE.C6 });
      this.tone(NOTE.E6 || 1318.51, { type: 'sine', dur: 0.2, gain: 0.05, delay: 0.08, verb: 0.4 });
    },
    undo() {
      this.tone(NOTE.G5, { type: 'triangle', dur: 0.08, gain: 0.08, slideTo: NOTE.E5 });
    },
    win() {
      const seq = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6 || 1318.51, NOTE.G6];
      seq.forEach((f, i) => {
        this.tone(f, { type: 'triangle', dur: 0.42, gain: 0.13, delay: i * 0.085, verb: 0.7 });
      });
      this.tone(NOTE.C5 / 2, { type: 'sine', dur: 0.9, gain: 0.1, delay: 0.12, verb: 0.5 });
    },
    lose() {
      const seq = [NOTE.G5, NOTE.E5, NOTE.D5, NOTE.C5 * 0.75];
      seq.forEach((f, i) => {
        this.tone(f, { type: 'triangle', dur: 0.3, gain: 0.12, delay: i * 0.11, verb: 0.5 });
      });
    },
    tick() {
      this.tone(1800, { type: 'sine', dur: 0.02, gain: 0.018 });
    }
  };

  root.Sound = Engine;
})(window);
