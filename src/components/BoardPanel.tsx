import { useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import type { ComponentProps } from 'react';

type ArrowList = NonNullable<ComponentProps<typeof Chessboard>['customArrows']>;

interface BoardPanelProps {
  fen: string;
  orientation: 'white' | 'black';
  selected: string | null;
  legalTargets: Set<string>;
  captureTargets: Set<string>;
  lastMove: { from: string; to: string } | null;
  checkSquare: string | null;
  pvArrow: [string, string] | null;
  gameId: number;
  onSquareClick: (square: string) => void;
  onPieceDrop: (from: string, to: string) => boolean;
  dark: boolean;
}

/** Radial dot for quiet legal moves; ring for captures. */
const DOT_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(circle, rgba(15, 118, 110, 0.55) 24%, transparent 26%)',
};
const RING_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(circle, transparent 58%, rgba(15, 118, 110, 0.55) 60%)',
};
const SELECTED_STYLE: React.CSSProperties = {
  background: 'rgba(56, 189, 248, 0.45)',
};
const LAST_MOVE_STYLE: React.CSSProperties = {
  background: 'rgba(250, 204, 21, 0.42)',
};
const CHECK_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(circle, rgba(239, 68, 68, 0.85) 12%, rgba(239, 68, 68, 0.35) 45%, transparent 72%)',
};

export function BoardPanel(props: BoardPanelProps) {
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (props.lastMove !== null) {
      styles[props.lastMove.from] = { ...styles[props.lastMove.from], ...LAST_MOVE_STYLE };
      styles[props.lastMove.to] = { ...styles[props.lastMove.to], ...LAST_MOVE_STYLE };
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
  }, [props.lastMove, props.checkSquare, props.selected, props.legalTargets, props.captureTargets]);

  const arrows = useMemo(() => {
    if (props.pvArrow === null) return [] as unknown as ArrowList;
    const arr: [string, string, string][] = [[props.pvArrow[0], props.pvArrow[1], 'rgba(14, 165, 233, 0.85)']];
    return arr as unknown as ArrowList;
  }, [props.pvArrow]);

  const light = props.dark ? '#7d97a8' : '#f0d9b5';
  const dark = props.dark ? '#4f6b7d' : '#b58863';

  return (
    <div className="w-full overflow-hidden rounded-xl shadow-xl ring-1 ring-slate-900/10 dark:ring-white/10">
      <Chessboard
        id={`chess0-${props.gameId}`}
        position={props.fen}
        boardOrientation={props.orientation}
        onSquareClick={(square: string) => props.onSquareClick(square)}
        onPieceDrop={(from: string, to: string) => props.onPieceDrop(from, to)}
        customSquareStyles={squareStyles}
        customArrows={arrows}
        customLightSquareStyle={{ backgroundColor: light }}
        customDarkSquareStyle={{ backgroundColor: dark }}
        customBoardStyle={{ borderRadius: 0 }}
        animationDuration={220}
      />
    </div>
  );
}
