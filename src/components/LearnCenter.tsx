import { useState } from 'react';
import type { AcademyModule } from '../engine/lessons';
import { ACADEMY_MODULES } from '../engine/lessons';

interface LearnCenterProps {
  activeModule: AcademyModule;
  activeStepIndex: number;
  lessonStatus: 'prompt' | 'completed' | 'wrong';
  completedLessons: string[];
  onStartLesson: (moduleId: string, stepIdx: number) => void;
  onShowArrowHint: (uci: string) => void;
}

export function LearnCenter({
  activeModule,
  activeStepIndex,
  lessonStatus,
  completedLessons,
  onStartLesson,
  onShowArrowHint,
}: LearnCenterProps) {
  const [showTip, setShowTip] = useState(false);
  const currentStep = activeModule.steps[activeStepIndex] ?? activeModule.steps[0];
  const totalSteps = ACADEMY_MODULES.reduce((acc, m) => acc + m.steps.length, 0);

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

  return (
    <div className="space-y-3.5 rounded-xl border border-stone-200/90 bg-white/85 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
      {/* Header & Progress */}
      <div className="flex items-center justify-between border-b border-stone-200/80 pb-2.5 dark:border-slate-800">
        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
            Interactive Chess Academy
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Learn by playing key Grandmaster concepts directly on the board
          </p>
        </div>
        <div className="font-mono text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
          {completedLessons.length}/{totalSteps} Mastered
        </div>
      </div>

      {/* Active Interactive Step Card */}
      <div className="space-y-2.5 rounded-lg border border-stone-200/80 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-800/45">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            {activeModule.category} · {activeModule.difficulty}
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            Lesson {activeStepIndex + 1} of {activeModule.steps.length}
          </span>
        </div>

        <h4 className="text-sm font-extrabold text-slate-900 dark:text-white">
          {currentStep.title}
        </h4>
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {currentStep.prompt}
        </p>

        {/* Feedback Banner */}
        {lessonStatus === 'prompt' && (
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => {
                setShowTip(true);
                if (currentStep.correctUci[0]) {
                  onShowArrowHint(currentStep.correctUci[0]);
                }
              }}
              className="rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 transition hover:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              💡 Show Coach Tip
            </button>
            <span className="text-[11px] font-medium text-slate-400">
              Make the move on the board →
            </span>
          </div>
        )}

        {lessonStatus === 'wrong' && (
          <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <span className="font-semibold text-amber-800 dark:text-amber-200">
              Not quite — check the Coach Tip and try another move on the board!
            </span>
            <button
              type="button"
              onClick={() => {
                setShowTip(true);
                if (currentStep.correctUci[0]) {
                  onShowArrowHint(currentStep.correctUci[0]);
                }
              }}
              className="shrink-0 font-bold text-emerald-600 underline dark:text-emerald-400"
            >
              Show Move
            </button>
          </div>
        )}

        {lessonStatus === 'completed' && (
          <div className="space-y-2 rounded-lg border border-emerald-500/50 bg-emerald-500/15 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-emerald-800 dark:text-emerald-200">
                ✓ Concept Mastered!
              </span>
              <button
                type="button"
                onClick={goNextStep}
                className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-emerald-500"
              >
                Next Lesson →
              </button>
            </div>
            <p className="text-[11px] text-slate-700 dark:text-slate-200">
              {currentStep.successNote}
            </p>
          </div>
        )}

        {(showTip || lessonStatus === 'wrong') && lessonStatus !== 'completed' && (
          <div className="rounded-md border border-stone-200 bg-white px-2.5 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <strong>Coach Tip:</strong> {currentStep.coachTip}
          </div>
        )}
      </div>

      {/* Curriculum Browser */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Academy Curriculum
        </div>
        <div className="scroll-thin max-h-56 space-y-2 overflow-y-auto pr-1">
          {ACADEMY_MODULES.map((mod) => {
            const isCurrentMod = mod.id === activeModule.id;
            return (
              <div
                key={mod.id}
                className={`rounded-lg border p-2.5 transition ${
                  isCurrentMod
                    ? 'border-emerald-500/50 bg-emerald-500/[0.04] dark:border-emerald-500/40'
                    : 'border-stone-200/80 bg-white dark:border-slate-800 dark:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                    {mod.title}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    {mod.difficulty}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {mod.summary}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {mod.steps.map((st, idx) => {
                    const done = completedLessons.includes(`${mod.id}:${idx}`);
                    const active = isCurrentMod && activeStepIndex === idx;
                    return (
                      <button
                        key={st.title}
                        type="button"
                        onClick={() => {
                          setShowTip(false);
                          onStartLesson(mod.id, idx);
                        }}
                        className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                          active
                            ? 'border-emerald-500 bg-emerald-600 text-white'
                            : done
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-stone-200 bg-stone-50 text-slate-600 hover:border-stone-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {done ? '✓ ' : ''}
                        {st.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
