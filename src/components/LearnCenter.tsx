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
    <div className="space-y-3 p-3.5">
      {/* Sub-navigation: Active Lesson vs All 16 Courses */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-stone-200/80 p-1 dark:bg-[#1f1e1b]">
        <button
          type="button"
          onClick={() => setViewTab('lesson')}
          className={`rounded-md py-1.5 text-xs font-extrabold transition ${
            viewTab === 'lesson'
              ? 'bg-white text-stone-900 shadow-xs dark:bg-[#302e2b] dark:text-white'
              : 'text-stone-600 hover:text-stone-900 dark:text-[#989795] dark:hover:text-white'
          }`}
        >
          Active Lesson
        </button>
        <button
          type="button"
          onClick={() => setViewTab('courses')}
          className={`rounded-md py-1.5 text-xs font-extrabold transition ${
            viewTab === 'courses'
              ? 'bg-white text-stone-900 shadow-xs dark:bg-[#302e2b] dark:text-white'
              : 'text-stone-600 hover:text-stone-900 dark:text-[#989795] dark:hover:text-white'
          }`}
        >
          16 Courses ({TOTAL_ACADEMY_LESSONS})
        </button>
      </div>

      {viewTab === 'lesson' ? (
        <div className="space-y-3">
          {/* Course Header & Progress Bar */}
          <div className="rounded-xl bg-stone-100 p-3 dark:bg-[#1f1e1b]">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded bg-[#81b64c]/20 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-[#629924] uppercase dark:text-[#81b64c]">
                {activeModule.difficulty} · {activeModule.category}
              </span>
              <span className="font-mono text-xs font-bold tabular-nums text-stone-500 dark:text-[#989795]">
                Lesson {activeStepIndex + 1} / {activeModule.steps.length}
              </span>
            </div>
            <div className="mt-1.5 text-xs font-extrabold text-stone-800 dark:text-white">
              {activeModule.title}
            </div>
            {/* Progress Bar */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-[#302e2b]">
              <div
                className="h-full bg-[#81b64c] transition-all duration-300"
                style={{
                  width: `${Math.max(5, Math.round((completedInActiveMod / activeModule.steps.length) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Interactive Lesson Challenge Card */}
          <div className="space-y-3 rounded-xl border border-stone-200/90 bg-stone-50/80 p-3.5 dark:border-white/10 dark:bg-[#302e2b]">
            <div>
              <h4 className="text-sm font-black text-stone-900 dark:text-white">
                {currentStep.title}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-[#bababa]">
                {currentStep.prompt}
              </p>
            </div>

            {(showTip || lessonStatus === 'wrong') && lessonStatus !== 'completed' && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
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
                    className="rounded-lg bg-stone-200/90 py-2 text-xs font-extrabold text-stone-800 transition hover:bg-stone-300 dark:bg-[#1f1e1b] dark:text-white dark:hover:bg-[#262522]"
                  >
                    💡 Coach Tip
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onShowArrowHint(currentStep.correctUci[0])}
                    className="rounded-lg bg-amber-500/20 py-2 text-xs font-extrabold text-amber-700 ring-1 ring-amber-500/40 transition hover:bg-amber-500/30 dark:text-amber-300"
                  >
                    🎯 Show Move Arrow
                  </button>
                )}

                <button
                  type="button"
                  onClick={goNextStep}
                  className="rounded-lg bg-stone-200/90 py-2 text-xs font-extrabold text-stone-700 transition hover:bg-stone-300 dark:bg-[#1f1e1b] dark:text-[#bababa] dark:hover:text-white"
                >
                  Skip Lesson →
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
                  className="shrink-0 rounded-md bg-stone-200 px-2.5 py-1 text-[11px] font-extrabold text-stone-800 dark:bg-[#1f1e1b] dark:text-white"
                >
                  🎯 Show Arrow
                </button>
              </div>
            )}

            {lessonStatus === 'completed' && (
              <div className="space-y-2.5 rounded-lg border border-[#81b64c]/50 bg-[#81b64c]/15 p-3">
                <div className="text-xs font-black text-[#4e7822] dark:text-[#a3d160]">
                  ★ Lesson Mastered!
                </div>
                <p className="text-xs leading-relaxed text-stone-700 dark:text-[#e4e4e0]">
                  {currentStep.successNote}
                </p>
                <button
                  type="button"
                  onClick={goNextStep}
                  className="w-full rounded-lg bg-[#81b64c] py-2.5 text-xs font-black text-white shadow-[0_3px_0_#537a28] transition hover:bg-[#8ec356]"
                >
                  Next Lesson →
                </button>
              </div>
            )}
          </div>

          {/* Step Strip for Current Course */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold tracking-wider text-stone-400 uppercase dark:text-[#7c7a77]">
              <span>Course Lessons ({activeModule.steps.length})</span>
              <button
                type="button"
                onClick={() => setViewTab('courses')}
                className="font-bold text-[#81b64c] hover:underline"
              >
                Switch Course →
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
                    className={`rounded-md px-2 py-1 font-mono text-[10px] font-bold transition ${
                      active
                        ? 'bg-[#81b64c] text-white'
                        : done
                          ? 'bg-[#81b64c]/20 text-[#81b64c]'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-[#1f1e1b] dark:text-[#bababa] dark:hover:bg-[#302e2b]'
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
        /* BROWSE ALL 16 COURSES & 432 LESSONS VIEW */
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1">
            {(['All', 'Beginner', 'Intermediate', 'Advanced', 'Master'] as const).map((track) => (
              <button
                key={track}
                type="button"
                onClick={() => setSelectedTrack(track)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-extrabold transition ${
                  selectedTrack === track
                    ? 'bg-[#81b64c] text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-[#1f1e1b] dark:text-[#bababa]'
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
            className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-800 placeholder:text-stone-400 focus:border-[#81b64c] focus:outline-none dark:border-white/10 dark:bg-[#1f1e1b] dark:text-white"
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
                      ? 'border-[#81b64c] bg-[#81b64c]/15'
                      : 'border-stone-200/80 bg-stone-50/70 hover:border-stone-300 dark:border-white/5 dark:bg-[#1f1e1b] dark:hover:bg-[#302e2b]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-stone-900 dark:text-white">
                      {mod.title}
                    </span>
                    <span className="shrink-0 rounded bg-stone-200/70 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-stone-700 dark:bg-[#302e2b] dark:text-[#bababa]">
                      {completedInMod}/{mod.steps.length} · {mod.difficulty}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-stone-500 dark:text-[#989795]">
                    {mod.summary}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

