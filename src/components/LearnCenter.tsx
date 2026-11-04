import { useMemo, useState } from 'react';
import type { AcademyModule, LessonTrack } from '../engine/lessons';
import { ACADEMY_MODULES, TOTAL_ACADEMY_LESSONS } from '../engine/lessons';

interface LearnCenterProps {
  activeModule: AcademyModule;
  activeStepIndex: number;
  lessonStatus: 'prompt' | 'completed' | 'wrong';
  completedLessons: string[];
  onStartLesson: (moduleId: string, stepIdx: number) => void;
  onShowArrowHint: (uci?: string) => void;
}

type AcademyTab = 'lesson' | 'courses';

export function LearnCenter({
  activeModule,
  activeStepIndex,
  lessonStatus,
  completedLessons,
  onStartLesson,
  onShowArrowHint,
}: LearnCenterProps) {
  const [viewTab, setViewTab] = useState<AcademyTab>('lesson');
  const [selectedTrack, setSelectedTrack] = useState<LessonTrack | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showTip, setShowTip] = useState(false);

  const currentStep = activeModule.steps[activeStepIndex] ?? activeModule.steps[0];

  const filteredModules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ACADEMY_MODULES.filter((mod) => {
      if (selectedTrack !== 'All' && mod.difficulty !== selectedTrack) return false;
      if (!q) return true;
      return (
        mod.title.toLowerCase().includes(q) ||
        mod.category.toLowerCase().includes(q) ||
        mod.summary.toLowerCase().includes(q) ||
        mod.steps.some((s) => s.title.toLowerCase().includes(q))
      );
    });
  }, [selectedTrack, searchQuery]);

  const goNextStep = () => {
    setShowTip(false);
    if (activeStepIndex + 1 < activeModule.steps.length) {
      onStartLesson(activeModule.id, activeStepIndex + 1);
    } else {
      const modIdx = ACADEMY_MODULES.findIndex((m) => m.id === activeModule.id);
      const nextMod = ACADEMY_MODULES[(modIdx + 1) % ACADEMY_MODULES.length];
      onStartLesson(nextMod.id, 0);
    }
  };

  const completedInActiveMod = activeModule.steps.filter((_, idx) =>
    completedLessons.includes(`${activeModule.id}:${idx}`),
  ).length;

  return (
    <div className="space-y-3">
      {/* Sub-navigation: active lesson vs courses */}
      <div className="seg grid grid-cols-2">
        <button
          type="button"
          onClick={() => setViewTab('lesson')}
          className={`seg-btn py-1.5 ${viewTab === 'lesson' ? 'seg-btn-active' : ''}`}
        >
          Active Lesson
        </button>
        <button
          type="button"
          onClick={() => setViewTab('courses')}
          className={`seg-btn py-1.5 ${viewTab === 'courses' ? 'seg-btn-active' : ''}`}
        >
          16 Courses ({TOTAL_ACADEMY_LESSONS})
        </button>
      </div>

      {viewTab === 'lesson' ? (
        <div className="space-y-3">
          {/* Course header & progress bar */}
          <div className="panel-sunken p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded bg-accent/15 px-2 py-0.5 text-2xs font-extrabold tracking-wider text-accent-text uppercase">
                {activeModule.difficulty} · {activeModule.category}
              </span>
              <span className="font-mono text-2xs font-bold tabular-nums text-ink-3">
                Lesson {activeStepIndex + 1} / {activeModule.steps.length}
              </span>
            </div>
            <div className="mt-1.5 text-xs font-extrabold text-ink">{activeModule.title}</div>
            {/* Progress bar */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--seg)]">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{
                  width: `${Math.max(5, Math.round((completedInActiveMod / activeModule.steps.length) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Interactive lesson challenge card */}
          <div className="panel space-y-3 p-3">
            <div>
              <h4 className="text-sm font-black text-ink">{currentStep.title}</h4>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{currentStep.prompt}</p>
            </div>

            {(showTip || lessonStatus === 'wrong') && lessonStatus !== 'completed' && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-200">
                <strong className="font-extrabold">💡 Coach Viktor’s Tip:</strong>{' '}
                {currentStep.coachTip}
              </div>
            )}

            {lessonStatus === 'prompt' && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {!showTip ? (
                  <button
                    type="button"
                    onClick={() => setShowTip(true)}
                    className="btn-quiet py-2 text-xs"
                  >
                    💡 Coach Tip
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onShowArrowHint(currentStep.correctUci[0])}
                    className="rounded-md bg-amber-500/20 py-2 text-xs font-extrabold text-amber-700 ring-1 ring-amber-500/40 transition hover:bg-amber-500/30 dark:text-amber-300"
                  >
                    🎯 Show Move Arrow
                  </button>
                )}

                <button
                  type="button"
                  onClick={goNextStep}
                  className="btn-quiet py-2 text-xs"
                >
                  Skip Lesson
                </button>
              </div>
            )}

            {lessonStatus === 'wrong' && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs">
                <span className="font-bold text-rose-600 dark:text-rose-400">
                  ✗ Try another move on the board!
                </span>
                <button
                  type="button"
                  onClick={() => onShowArrowHint(currentStep.correctUci[0])}
                  className="shrink-0 rounded-md border border-line bg-sunken px-2.5 py-1 text-2xs font-extrabold text-ink-2"
                >
                  🎯 Show Arrow
                </button>
              </div>
            )}

            {lessonStatus === 'completed' && (
              <div className="space-y-2.5 rounded-lg border border-accent/50 bg-accent/15 p-3">
                <div className="text-xs font-black text-accent-text">★ Lesson Mastered!</div>
                <p className="text-xs leading-relaxed text-ink">{currentStep.successNote}</p>
                <button
                  type="button"
                  onClick={goNextStep}
                  className="btn-primary w-full py-2.5 text-xs font-black"
                >
                  Next Lesson
                </button>
              </div>
            )}
          </div>

          {/* Step strip for current course */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="micro-label">Course Lessons ({activeModule.steps.length})</span>
              <button
                type="button"
                onClick={() => setViewTab('courses')}
                className="text-2xs font-bold text-accent-text hover:underline"
              >
                Switch Course
              </button>
            </div>
            <div className="scroll-thin flex max-h-24 flex-wrap gap-1 overflow-y-auto pr-1">
              {activeModule.steps.map((_, idx) => {
                const done = completedLessons.includes(`${activeModule.id}:${idx}`);
                const active = activeStepIndex === idx;
                return (
                  <button
                    key={`${activeModule.id}-${idx}`}
                    type="button"
                    onClick={() => {
                      setShowTip(false);
                      onStartLesson(activeModule.id, idx);
                    }}
                    className={`rounded-md px-2 py-1 font-mono text-2xs font-bold transition ${
                      active
                        ? 'bg-accent text-on-accent'
                        : done
                          ? 'bg-accent/15 text-accent-text'
                          : 'border border-line bg-sunken text-ink-2 hover:bg-raised-hover'
                    }`}
                  >
                    {done ? '✓' : ''}
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Browse all courses & lessons view */
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1">
            {(['All', 'Beginner', 'Intermediate', 'Advanced', 'Master'] as const).map((track) => (
              <button
                key={track}
                type="button"
                onClick={() => setSelectedTrack(track)}
                className={`rounded-md px-2.5 py-1 text-2xs font-extrabold transition ${
                  selectedTrack === track
                    ? 'bg-accent text-on-accent'
                    : 'border border-line bg-sunken text-ink-2'
                }`}
              >
                {track}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search 16 courses & 432 lessons (e.g. Sicilian, Fork, Endgame)…"
            className="field"
          />

          <div className="scroll-thin max-h-72 space-y-2 overflow-y-auto pr-1">
            {filteredModules.map((mod) => {
              const isCurrentMod = mod.id === activeModule.id;
              const completedInMod = mod.steps.filter((_, idx) =>
                completedLessons.includes(`${mod.id}:${idx}`),
              ).length;

              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => {
                    setShowTip(false);
                    onStartLesson(mod.id, 0);
                    setViewTab('lesson');
                  }}
                  className={`block w-full rounded-xl border p-3 text-left transition ${
                    isCurrentMod
                      ? 'border-accent bg-accent/15'
                      : 'border-line bg-sunken hover:border-line-strong'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-ink">{mod.title}</span>
                    <span className="shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-2xs font-bold tabular-nums text-ink-2">
                      {completedInMod}/{mod.steps.length} · {mod.difficulty}
                    </span>
                  </div>
                  <p className="mt-1 text-2xs text-ink-3">{mod.summary}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
