import { useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import type { ComponentProps } from 'react';
import type { BoardTheme } from '../useChessGame';
import type { MultiPvLine } from '../engine/search';
import type { MoveAnalysisData } from '../engine/analysis';
import { CLASSIFICATION_META } from '../engine/analysis';

type ArrowList = NonNullable<ComponentProps<typeof Chessboard>['customArrows']>;

interface BoardPanelProps {
  fen: string;
  orientation: 'white' | 'black';
  selected: string | null;
  hintSquare?: string | null;
  legalTargets: Set<string>;
  captureTargets: Set<string>;
  lastMove: { from: string; to: string } | null;
  checkSquare: string | null;
  pvArrow: [string, string] | null;
  multiPv: MultiPvLine[];
  showMultiPvArrows: boolean;
  lastMoveAnalysis?: MoveAnalysisData | null;
  gameId: number;
  boardWidth?: number;
  onSquareClick: (square: string) => void;
  onPieceDrop: (from: string, to: string) => boolean;
  boardTheme: BoardTheme;
}

export const BOARD_PALETTES: Record<
  BoardTheme,
  { label: string; light: string; dark: string; frame: string }
> = {
  emerald: {
    label: 'Championship Green',
    light: '#ebecd0',
    dark: '#739552',
    frame: 'ring-black/25 dark:ring-black/40',
  },
  walnut: {
    label: 'Tournament Walnut',
    light: '#edd6b0',
    dark: '#b88762',
    frame: 'ring-stone-900/20 dark:ring-black/40',
  },
  slate: {
    label: 'Nordic Slate',
    light: '#dee3e6',
    dark: '#788a94',
    frame: 'ring-slate-900/20 dark:ring-black/40',
  },
  arctic: {
    label: 'Obsidian Ice',
    light: '#d8e4ec',
    dark: '#4b6578',
    frame: 'ring-sky-950/20 dark:ring-black/40',
  },
};

/** Radial dot for quiet legal moves; ring for captures. */
const DOT_STYLE: React.CSSProperties = {
  background: 'radial-gradient(circle, rgba(0, 0, 0, 0.22) 21%, transparent 23%)',
};
const RING_STYLE: React.CSSProperties = {
  background: 'radial-gradient(circle, transparent 59%, rgba(0, 0, 0, 0.24) 62%)',
};
const SELECTED_STYLE: React.CSSProperties = {
  background: 'rgba(255, 255, 51, 0.5)',
};
const LAST_MOVE_STYLE: React.CSSProperties = {
  background: 'rgba(245, 246, 130, 0.48)',
};
const HINT_SQUARE_STYLE: React.CSSProperties = {
  background: 'rgba(129, 182, 76, 0.62)',
  boxShadow: 'inset 0 0 0 3px rgba(255, 255, 255, 0.85)',
};
const CHECK_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(circle, rgba(239, 68, 68, 0.9) 16%, rgba(239, 68, 68, 0.42) 52%, transparent 74%)',
};

const MULTIPV_COLORS = [
  'rgba(129, 182, 76, 0.92)', // Rank #1 Best Move (Chess.com Green)
  'rgba(56, 189, 248, 0.80)', // Rank #2 Alternative (Sky)
  'rgba(245, 158, 11, 0.75)', // Rank #3 Alternative (Amber)
];

function squareOverlayCoords(
  sq: string,
  orientation: 'white' | 'black',
): { leftPct: number; topPct: number } | null {
  if (sq.length !== 2) return null;
  const file = sq.charCodeAt(0) - 97; // 0..7
  const rank = sq.charCodeAt(1) - 49; // 0..7
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  return {
    leftPct: col * 12.5,
    topPct: row * 12.5,
  };
}

export function BoardPanel(props: BoardPanelProps) {
  const palette = BOARD_PALETTES[props.boardTheme] ?? BOARD_PALETTES.emerald;

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (props.lastMove !== null) {
      styles[props.lastMove.from] = { ...styles[props.lastMove.from], ...LAST_MOVE_STYLE };
      styles[props.lastMove.to] = { ...styles[props.lastMove.to], ...LAST_MOVE_STYLE };
    }
    if (props.hintSquare) {
      styles[props.hintSquare] = { ...styles[props.hintSquare], ...HINT_SQUARE_STYLE };
    }
    if (props.checkSquare !== null) {
      styles[props.checkSquare] = { ...styles[props.checkSquare], ...CHECK_STYLE };
    }
    if (props.selected !== null) {
      styles[props.selected] = { ...styles[props.selected], ...SELECTED_STYLE };
    }
    for (const sq of props.legalTargets) {
      styles[sq] = { ...styles[sq], ...(props.captureTargets.has(sq) ? RING_STYLE : DOT_STYLE) };
    }
    return styles;
  }, [
    props.lastMove,
    props.hintSquare,
    props.checkSquare,
    props.selected,
    props.legalTargets,
    props.captureTargets,
  ]);

  const arrows = useMemo(() => {
    const arr: [string, string, string][] = [];
    const seen = new Set<string>();

    // If viewing a mistake/blunder/inaccuracy in history, highlight the missed best move arrow
    const missedBestUci = props.lastMoveAnalysis?.bestAlternativeUci;
    const cl = props.lastMoveAnalysis?.classification;
    if (
      missedBestUci &&
      missedBestUci.length >= 4 &&
      (cl === 'inaccuracy' || cl === 'mistake' || cl === 'blunder')
    ) {
      const from = missedBestUci.slice(0, 2);
      const to = missedBestUci.slice(2, 4);
      const key = `${from}-${to}`;
      seen.add(key);
      arr.push([from, to, MULTIPV_COLORS[0]]);
    }

    if (props.showMultiPvArrows && props.multiPv.length > 0) {
      // Draw Rank #3, #2, then #1 on top
      const lines = [...props.multiPv].slice(0, 3).reverse();
      for (const line of lines) {
        if (!line.uci || line.uci.length < 4) continue;
        const from = line.uci.slice(0, 2);
        const to = line.uci.slice(2, 4);
        const key = `${from}-${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const color = MULTIPV_COLORS[Math.min(line.rank - 1, 2)];
        arr.push([from, to, color]);
      }
    } else if (props.pvArrow !== null) {
      const key = `${props.pvArrow[0]}-${props.pvArrow[1]}`;
      if (!seen.has(key)) {
        arr.push([props.pvArrow[0], props.pvArrow[1], MULTIPV_COLORS[0]]);
      }
    }

    return arr as unknown as ArrowList;
  }, [props.multiPv, props.pvArrow, props.showMultiPvArrows, props.lastMoveAnalysis]);

  const badgeOverlay = useMemo(() => {
    if (!props.lastMove || !props.lastMoveAnalysis) return null;
    const coords = squareOverlayCoords(props.lastMove.to, props.orientation);
    if (!coords) return null;
    const meta = CLASSIFICATION_META[props.lastMoveAnalysis.classification];
    return {
      coords,
      meta,
      analysis: props.lastMoveAnalysis,
    };
  }, [props.lastMove, props.lastMoveAnalysis, props.orientation]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg shadow-board ring-1 ${palette.frame}`}
      style={
        props.boardWidth
          ? { width: `${props.boardWidth}px`, height: `${props.boardWidth}px` }
          : undefined
      }
    >
      <Chessboard
        id={`chess0-${props.gameId}`}
        position={props.fen}
        boardWidth={props.boardWidth}
        boardOrientation={props.orientation}
        onSquareClick={(square: string) => props.onSquareClick(square)}
        onPieceDrop={(from: string, to: string) => props.onPieceDrop(from, to)}
        customSquareStyles={squareStyles}
        customArrows={arrows}
        customLightSquareStyle={{ backgroundColor: palette.light }}
        customDarkSquareStyle={{ backgroundColor: palette.dark }}
        customBoardStyle={{ borderRadius: 0 }}
        animationDuration={180}
      />

      {/* Move classification badge anchored on the destination square of the last move */}
      {badgeOverlay !== null && (
        <div
          className="pointer-events-none absolute z-20 flex items-start justify-end p-0.5 transition-all duration-150"
          style={{
            left: `${badgeOverlay.coords.leftPct}%`,
            top: `${badgeOverlay.coords.topPct}%`,
            width: '12.5%',
            height: '12.5%',
          }}
        >
          <span
            title={`${badgeOverlay.meta.label}: ${badgeOverlay.meta.description}`}
            className="flex h-5 min-w-5 translate-x-1 -translate-y-1 items-center justify-center rounded-full px-1 text-2xs font-extrabold text-white shadow-card ring-2 ring-black/25"
            style={{ backgroundColor: badgeOverlay.meta.badgeBg }}
          >
            {badgeOverlay.meta.symbol}
          </span>
        </div>
      )}
    </div>
  );
}

