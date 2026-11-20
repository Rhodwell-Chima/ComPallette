/**
 * Web Audio API synthetic alert buzzer for industrial control-room terminals.
 * Generates an authentic alternating dual-tone safety buzzer pattern.
 */
export function playSyntheticAlertSound(volume = 0.7, frequency = 880) {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const now = ctx.currentTime;
    osc.type = 'sawtooth';

    // Alternating dual-tone industrial safety pattern (880Hz -> 1046Hz -> 880Hz)
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.setValueAtTime(frequency * 1.18, now + 0.12);
    osc.frequency.setValueAtTime(frequency, now + 0.24);
    osc.frequency.setValueAtTime(frequency * 1.18, now + 0.36);

    const safeVol = Math.max(0.01, Math.min(volume, 1.0)) * 0.22;
    gain.gain.setValueAtTime(safeVol, now);
    gain.gain.setValueAtTime(safeVol, now + 0.44);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.5);
  } catch (err) {
    console.warn('Web Audio API playback unavailable:', err);
  }
}
