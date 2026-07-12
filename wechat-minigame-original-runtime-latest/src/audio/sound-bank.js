const BASE = "runtime-assets/animal-cup/audio/";

class SoundBank {
  constructor(wxApi) {
    this.wx = wxApi;
    this.muted = false;
    this.loops = {};
    this.oneshots = new Set();
  }

  create(id, loop, volume) {
    if (!this.wx || typeof this.wx.createInnerAudioContext !== "function") return null;
    const audio = this.wx.createInnerAudioContext();
    audio.src = `${BASE}${id}.mp3`;
    audio.loop = !!loop;
    audio.volume = Math.max(0, Math.min(1, Number(volume) || 0.7));
    audio.obeyMuteSwitch = false;
    return audio;
  }

  play(id, options) {
    options = options || {};
    if (this.muted) return null;
    const audio = this.create(id, false, options.volume == null ? 0.75 : options.volume);
    if (!audio) return null;
    const cleanup = () => {
      this.oneshots.delete(audio);
      try { audio.destroy(); } catch (error) {}
    };
    if (audio.onEnded) audio.onEnded(cleanup);
    if (audio.onError) audio.onError(cleanup);
    this.oneshots.add(audio);
    try { audio.play(); } catch (error) { cleanup(); }
    return audio;
  }

  startLoop(slot, id, volume) {
    if (this.muted || this.loops[slot]) return;
    const audio = this.create(id, true, volume);
    if (!audio) return;
    this.loops[slot] = audio;
    try { audio.play(); } catch (error) {
      delete this.loops[slot];
      try { audio.destroy(); } catch (destroyError) {}
    }
  }

  stopLoop(slot) {
    const audio = this.loops[slot];
    if (!audio) return;
    delete this.loops[slot];
    try { audio.stop(); } catch (error) {}
    try { audio.destroy(); } catch (error) {}
  }

  startMatchAmbience() {
    this.startLoop("crowd", "crowd_ambience", 0.28);
    this.startLoop("music", "music_bed", 0.16);
  }

  stopMatchAmbience() {
    this.stopLoop("crowd");
    this.stopLoop("music");
  }

  setMuted(value) {
    this.muted = !!value;
    if (this.muted) {
      this.stopMatchAmbience();
      for (const audio of this.oneshots) {
        try { audio.stop(); } catch (error) {}
        try { audio.destroy(); } catch (error) {}
      }
      this.oneshots.clear();
    } else {
      this.startMatchAmbience();
      this.play("ui_select", { volume: 0.5 });
    }
  }

  toggle() {
    this.setMuted(!this.muted);
    return !this.muted;
  }
}

module.exports = { SoundBank, BASE };
