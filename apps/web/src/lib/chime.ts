// A soft notification sound made with the Web Audio API: no audio files, very low volume, under half a second.
// Browsers only allow sound after the person has interacted with the page, so the context is created and resumed on
// the first click or key press; before that, announcements are silent rather than blocked noisily.
type Tone = "positive" | "negative" | "attention";

const SOUND_KEY = "nd-sound";
const SOUND_EVENT = "nd-sound-change";
let context: AudioContext | null = null;

export function unlockAudio() {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
  } catch { /* Audio is optional. */ }
}

// Gentle two-note shapes: rising for good news, a soft low note for bad news, a level pair for "look at this".
const shapes: Record<Tone, number[]> = { positive: [659.25, 880], negative: [261.63, 196], attention: [523.25, 523.25] };

export function playChime(tone: Tone) {
  try {
    if (!context || context.state !== "running") return;
    const start = context.currentTime + 0.02;
    shapes[tone].forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const at = start + index * 0.16;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.36);
    });
  } catch { /* Audio is optional. */ }
}

export function readSoundEnabled(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}

export function writeSoundEnabled(enabled: boolean) {
  try { localStorage.setItem(SOUND_KEY, enabled ? "on" : "off"); } catch { /* Preference stays for this page view only. */ }
  window.dispatchEvent(new Event(SOUND_EVENT));
}

export function subscribeSound(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SOUND_EVENT, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(SOUND_EVENT, onChange); };
}
