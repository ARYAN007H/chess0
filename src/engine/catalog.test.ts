import test from 'node:test';
import assert from 'node:assert/strict';
import { PUZZLE_LIBRARY } from './puzzles';
import { ACADEMY_MODULES, TOTAL_ACADEMY_LESSONS, describeCoachSuggestion } from './lessons';
import { Engine } from './engine';
import { chessNotationToSpeech } from '../coachTts';
import { materialStatus } from '../components/PlayerCard';

test('PUZZLE_LIBRARY contains at least 500 verified legal tactical puzzles', () => {
  assert.ok(
    PUZZLE_LIBRARY.length >= 500,
    `Expected >= 500 puzzles, got ${PUZZLE_LIBRARY.length}`,
  );

  for (const puz of PUZZLE_LIBRARY) {
    const eng = new Engine();
    eng.reset(puz.initialFen);
    if (puz.setupMoveUci) {
      const sm = eng.uciToMove(puz.setupMoveUci);
      assert.ok(sm !== null, `Puzzle ${puz.id} setupMoveUci ${puz.setupMoveUci} illegal`);
      eng.applyMove(sm);
    }
    for (const solUci of puz.solutionUci) {
      const m = eng.uciToMove(solUci);
      assert.ok(
        m !== null,
        `Puzzle ${puz.id} (${puz.title}) solution move ${solUci} illegal in FEN ${eng.fen()}`,
      );
      eng.applyMove(m);
    }
  }
});

test('ACADEMY_MODULES contains at least 400 verified legal interactive lessons', () => {
  assert.ok(
    TOTAL_ACADEMY_LESSONS >= 400,
    `Expected >= 400 lessons, got ${TOTAL_ACADEMY_LESSONS}`,
  );

  for (const mod of ACADEMY_MODULES) {
    assert.ok(mod.steps.length > 0, `Module ${mod.id} has no steps`);
    for (const step of mod.steps) {
      for (const uci of step.correctUci) {
        const eng = new Engine();
        eng.reset(step.fen);
        const m = eng.uciToMove(uci);
        assert.ok(
          m !== null,
          `Academy ${mod.id} (${step.title}) move ${uci} illegal in FEN ${step.fen}`,
        );
      }
    }
  }
});

test('chessNotationToSpeech translates algebraic moves into spoken English', () => {
  assert.equal(chessNotationToSpeech('O-O'), 'castles kingside');
  assert.equal(chessNotationToSpeech('Nxf7+'), 'Knight takes f7, check');
  assert.equal(chessNotationToSpeech('Qxd8#'), 'Queen takes d8, checkmate');
});

test('describeCoachSuggestion explains classical opening moves and tactical motifs', () => {
  const eng = new Engine();
  const e4Move = eng.uciToMove('e2e4')!;
  const e4Note = describeCoachSuggestion(eng.pos, {
    rank: 1,
    move: e4Move,
    uci: 'e2e4',
    san: 'e4',
    scoreCp: 35,
    pvUci: ['e2e4', 'e7e5'],
    pvSan: ['e4', 'e5'],
    selected: true,
  });
  assert.ok(e4Note.includes('d5 & f5'), `Unexpected e4 explanation: ${e4Note}`);
});

test('materialStatus computes clean net material imbalance instead of missing starting pieces', () => {
  const eng = new Engine();
  // Puzzle #1 Back-Rank Corridor Strike: White has R + 3P + K, Black has 3P + K
  eng.reset('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  const mat = materialStatus(eng.pieceCounts());
  assert.deepEqual(mat.whiteCaptured, [4]);
  assert.deepEqual(mat.blackCaptured, []);
  assert.equal(mat.whiteDiff, 5);
});
