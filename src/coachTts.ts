/**
 * Clean-room Chess Coach Text-to-Speech (TTS) Engine (`src/coachTts.ts`).
 *
 * Translates algebraic chess notation (e.g., "Nxf7+", "O-O-O", "Qxd8#", "1. e4")
 * into natural spoken English and speaks via the browser's Web Speech API.
 */

const PIECE_SPOKEN: Record<string, string> = {
  K: 'King',
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
};

/**
 * Converts algebraic chess notation tokens inside a sentence into natural spoken words.
 */
export function chessNotationToSpeech(text: string): string {
  return text
    .replace(/O-O-O/g, 'castles queenside')
    .replace(/O-O/g, 'castles kingside')
    .replace(/\b([KQRBN])([a-h]?[1-8]?)(x?)([a-h][1-8])(=[QRBN])?([+#])?/g, (_m, p, dis, cap, sq, promo, chk) => {
      const piece = PIECE_SPOKEN[p] || p;
      const fromPart = dis ? ` ${dis}` : '';
      const takesPart = cap === 'x' ? ' takes ' : ' to ';
      const promoPart = promo ? ` promotes to ${PIECE_SPOKEN[promo[1]] || 'Queen'}` : '';
      const chkPart = chk === '#' ? ', checkmate' : chk === '+' ? ', check' : '';
      return `${piece}${fromPart}${takesPart}${sq}${promoPart}${chkPart}`;
    })
    .replace(/\b([a-h])x([a-h][1-8])(=[QRBN])?([+#])?/g, (_m, file, sq, promo, chk) => {
      const promoPart = promo ? ` promotes to ${PIECE_SPOKEN[promo[1]] || 'Queen'}` : '';
      const chkPart = chk === '#' ? ', checkmate' : chk === '+' ? ', check' : '';
      return `${file} takes ${sq}${promoPart}${chkPart}`;
    })
    .replace(/[★✓○📖]/g, '')
    .replace(/\!\!/g, ' brilliant move ')
    .replace(/\?\?/g, ' blunder ')
    .replace(/\?\!/g, ' inaccuracy ')
    .replace(/\s+/g, ' ')
    .trim();
}

class CoachVoiceController {
  private enabled = false;

  constructor() {
    try {
      this.enabled = localStorage.getItem('chess0-tts') === 'on';
    } catch {
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem('chess0-tts', on ? 'on' : 'off');
    } catch {}
    if (!on) this.stop();
  }

  stop(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
  }

  speak(rawText: string, force = false): void {
    if ((!this.enabled && !force) || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const spoken = chessNotationToSpeech(rawText);
      if (!spoken) return;
      const utter = new SpeechSynthesisUtterance(spoken);
      utter.rate = 1.04;
      utter.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => v.lang.startsWith('en') && /natural|google|daniel|samantha|alex/i.test(v.name)) ??
        voices.find((v) => v.lang.startsWith('en'));
      if (preferred) utter.voice = preferred;
      window.speechSynthesis.speak(utter);
    } catch {}
  }
}

export const coachVoice = new CoachVoiceController();
