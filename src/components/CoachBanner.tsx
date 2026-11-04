import { useEffect, useRef } from 'react';
import { coachVoice } from '../coachTts';

export type CoachMood = 'neutral' | 'excited' | 'thinking' | 'warning' | 'locked';

export interface CoachMessage {
  mood: CoachMood;
  headline: string;
  body: string;
  badgeText?: string;
  badgeColor?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface CoachBannerProps {
  message: CoachMessage;
  ttsEnabled: boolean;
  onToggleTts: (on: boolean) => void;
}

function CoachAvatarSvg({ mood }: { mood: CoachMood }) {
  const accent =
    mood === 'excited'
      ? '#81b64c'
      : mood === 'warning'
        ? '#e58f2a'
        : mood === 'locked'
          ? '#7c7a77'
          : '#5c9fd8';

  return (
    <div className="relative shrink-0">
      <svg
        viewBox="0 0 64 64"
        className="h-12 w-12 overflow-visible rounded-lg bg-chrome p-0.5 shadow-card ring-2 ring-black/25"
        aria-hidden="true"
      >
        {/* Warm background glow */}
        <rect x="2" y="2" width="60" height="60" rx="10" fill={accent} fillOpacity="0.18" />
        {/* Grandmaster blazer */}
        <path
          d="M10 60 C10 46 19 41 32 41 C45 41 54 46 54 60 Z"
          fill="#2b2926"
          stroke={accent}
          strokeWidth="1.5"
        />
        {/* Crisp collar & tie */}
        <path d="M26 41 L32 53 L38 41 Z" fill="#ffffff" />
        <path d="M30.5 44 L32 56 L33.5 44 Z" fill={accent} />
        {/* Head */}
        <circle cx="32" cy="25" r="13.5" fill="#f3d4b7" stroke="#1f1e1b" strokeWidth="1.4" />
        {/* Silver-streaked grandmaster hair */}
        <path
          d="M18.5 23 C18.5 12 24.5 9.5 32 9.5 C39.5 9.5 45.5 12 45.5 23 C42.5 17.5 37.5 15.5 32 15.5 C26.5 15.5 21.5 17.5 18.5 23 Z"
          fill="#4a4845"
        />
        {/* Signature horn-rimmed glasses */}
        <rect
          x="21.5"
          y="20.5"
          width="8.5"
          height="6.2"
          rx="2"
          fill="#ffffff"
          fillOpacity="0.22"
          stroke="#1f1e1b"
          strokeWidth="1.7"
        />
        <rect
          x="34"
          y="20.5"
          width="8.5"
          height="6.2"
          rx="2"
          fill="#ffffff"
          fillOpacity="0.22"
          stroke="#1f1e1b"
          strokeWidth="1.7"
        />
        <line x1="30" y1="23.5" x2="34" y2="23.5" stroke="#1f1e1b" strokeWidth="1.7" />
        {/* Eyes */}
        <circle cx="25.8" cy="23.6" r="1.5" fill="#1f1e1b" />
        <circle cx="38.2" cy="23.6" r="1.5" fill="#1f1e1b" />
        {/* Expressive mouth */}
        {mood === 'excited' ? (
          <path
            d="M27 31 Q32 36 37 31"
            fill="none"
            stroke="#1f1e1b"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        ) : mood === 'warning' ? (
          <path
            d="M28 33.2 Q32 30.2 36 33.2"
            fill="none"
            stroke="#1f1e1b"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M28 31.5 Q32 33.8 36 31.5"
            fill="none"
            stroke="#1f1e1b"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        )}
      </svg>

      {/* Corner classification / mood badge */}
      <span
        className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-mono text-2xs font-black text-white shadow ring-2 ring-sunken"
        style={{ backgroundColor: accent }}
      >
        {mood === 'excited' ? '!!' : mood === 'warning' ? '?' : mood === 'locked' ? '🔒' : 'GM'}
      </span>
    </div>
  );
}

export function CoachBanner({ message, ttsEnabled, onToggleTts }: CoachBannerProps) {
  const lastSpokenRef = useRef<string>('');

  useEffect(() => {
    const combined = `${message.headline}. ${message.body}`;
    if (ttsEnabled && combined !== lastSpokenRef.current && message.mood !== 'locked') {
      lastSpokenRef.current = combined;
      coachVoice.speak(combined);
    }
  }, [message.headline, message.body, message.mood, ttsEnabled]);

  return (
    <div className="flex items-start gap-2.5 border-b border-line bg-sunken p-2.5">
      <CoachAvatarSvg mood={message.mood} />

      {/* Speech bubble with left tail */}
      <div className="relative min-w-0 flex-1 rounded-lg border border-line bg-surface p-2.5 text-ink shadow-card">
        {/* Speech bubble triangle tail */}
        <span
          aria-hidden="true"
          className="absolute top-4 -left-[7px] h-3 w-3 rotate-45 border-b border-l border-line bg-surface"
        />

        <div className="relative flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-2xs font-black tracking-wider text-ink-3 uppercase">
              GM Coach Viktor
            </span>
            {message.badgeText && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 font-mono text-2xs font-extrabold text-white"
                style={{ backgroundColor: message.badgeColor || '#81b64c' }}
              >
                {message.badgeText}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => coachVoice.speak(`${message.headline}. ${message.body}`, true)}
              title="Read coach explanation aloud"
              aria-label="Read coach explanation aloud"
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-2xs font-bold text-ink-2 transition hover:bg-accent hover:text-on-accent"
            >
              🔊
            </button>
            <button
              type="button"
              onClick={() => onToggleTts(!ttsEnabled)}
              title={ttsEnabled ? 'Disable automatic voice coach' : 'Enable automatic voice coach'}
              aria-label={
                ttsEnabled ? 'Disable automatic voice coach' : 'Enable automatic voice coach'
              }
              className={`rounded px-1.5 py-0.5 text-2xs font-bold transition ${
                ttsEnabled
                  ? 'bg-accent text-on-accent'
                  : 'border border-line bg-surface text-ink-2 hover:bg-raised-hover'
              }`}
            >
              {ttsEnabled ? 'Voice On' : 'Voice'}
            </button>
          </div>
        </div>

        <div className="relative mt-1 text-xs font-extrabold leading-snug text-ink">
          {message.headline}
        </div>

        <p className="relative mt-0.5 line-clamp-2 text-xs leading-snug font-medium text-ink-2">
          {message.body}
        </p>

        {message.actionLabel && message.onAction && (
          <button
            type="button"
            onClick={message.onAction}
            className="btn-primary relative mt-1.5 px-2.5 py-1 text-2xs"
          >
            {message.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
