export type PuyoCell = string | null;
export type PuyoBoard = PuyoCell[][];
export type PuyoPair = {
  axisColumn: number;
  axisRow: number;
  visualAxisColumn: number;
  visualAxisRow: number;
  rotation: 0 | 1 | 2 | 3;
  axisColor: string;
  childColor: string;
};
export type PuyoGameState = {
  board: PuyoBoard;
  pair: PuyoPair | null;
  nextPair: Pick<PuyoPair, "axisColor" | "childColor">;
  fallingCells: Map<string, number>;
  rngState: number;
  score: number;
  chain: number;
  pendingAttack: number;
  incomingOjama: number;
  gameOver: boolean;
  paused: boolean;
  resolving: boolean;
  lockStartedAt: number;
  spawnReadyAt: number;
  clearingCells: Set<string>;
  clearStartedAt: number;
  nextResolveAt: number;
};
export type PuyoCpuMove = {
  targetColumn: number;
  targetRotation: PuyoPair["rotation"];
};

type PuyoGravityResult = {
  fallingCells: Map<string, number>;
  maxDistance: number;
};
type PuyoMoveSimulation = {
  board: PuyoBoard;
  move: PuyoCpuMove;
  chain: number;
  coloredCleared: number;
  score: number;
  gameOver: boolean;
};
const OJAMA_PUYO_COLOR = "#cbd5e1";

export function createPuyoGame(columns: number, rows: number, fillRows: number, seed: number, colors: string[]): PuyoGameState {
  const board = emptyPuyoBoard(columns, rows);
  for (const cell of seededPuyoCells(columns, rows, fillRows, seed, colors)) {
    board[cell.row]![cell.column] = cell.color;
  }
  let rngState = normalizeRngSeed(seed);
  const firstPair = createRandomPuyoPair(columns, colors, rngState);
  rngState = firstPair.rngState;
  const nextPair = createRandomPuyoPair(columns, colors, rngState);
  rngState = nextPair.rngState;
  return {
    board,
    pair: firstPair.pair,
    nextPair: nextPair.pair,
    fallingCells: new Map(),
    rngState,
    score: 0,
    chain: 0,
    pendingAttack: 0,
    incomingOjama: 0,
    gameOver: false,
    paused: false,
    resolving: false,
    lockStartedAt: 0,
    spawnReadyAt: 0,
    clearingCells: new Set(),
    clearStartedAt: 0,
    nextResolveAt: 0
  };
}

export function activePairRenderCells(pair: PuyoPair): Array<{ column: number; row: number; color: string; alpha: number }> {
  const child = childOffset(pair.rotation);
  return [
    { column: pair.visualAxisColumn, row: pair.visualAxisRow, color: pair.axisColor, alpha: 1 },
    { column: pair.visualAxisColumn + child.column, row: pair.visualAxisRow + child.row, color: pair.childColor, alpha: 0.96 }
  ];
}

export function movePuyoPair(game: PuyoGameState, columns: number, rows: number, deltaColumn: number, deltaRow: number): boolean {
  if (!game.pair) return false;
  const nextPair = { ...game.pair, axisColumn: game.pair.axisColumn + deltaColumn, axisRow: game.pair.axisRow + deltaRow };
  if (!canPlacePuyoPair(game.board, nextPair, columns, rows)) return false;
  game.pair = nextPair;
  if (deltaColumn !== 0) game.lockStartedAt = 0;
  return true;
}

export function rotatePuyoPair(game: PuyoGameState, columns: number, rows: number, direction: number): boolean {
  if (!game.pair) return false;
  const nextRotation = (((game.pair.rotation + direction) % 4) + 4) % 4 as PuyoPair["rotation"];
  const candidates = [
    { ...game.pair, rotation: nextRotation },
    { ...game.pair, rotation: nextRotation, axisColumn: game.pair.axisColumn - 1 },
    { ...game.pair, rotation: nextRotation, axisColumn: game.pair.axisColumn + 1 },
    { ...game.pair, rotation: nextRotation, axisRow: game.pair.axisRow - 1 }
  ];
  const previousAxisRow = game.pair.axisRow;
  const candidate = candidates.find((pair) => canPlacePuyoPair(game.board, pair, columns, rows));
  if (!candidate) return false;
  game.pair = {
    ...candidate,
    visualAxisRow: candidate.axisRow < previousAxisRow ? candidate.axisRow : candidate.visualAxisRow
  };
  game.lockStartedAt = 0;
  return true;
}

export function advanceActivePuyoFall(game: PuyoGameState, columns: number, rows: number, fallRows: number): boolean {
  if (!game.pair) return false;
  const pair = game.pair;
  const landingAxisRow = findLandingAxisRow(game.board, pair, columns, rows);
  const nextVisualAxisRow = Math.min(landingAxisRow, pair.visualAxisRow + Math.max(0, fallRows));
  game.pair = {
    ...pair,
    axisRow: Math.min(landingAxisRow, Math.floor(nextVisualAxisRow)),
    visualAxisRow: nextVisualAxisRow
  };
  return nextVisualAxisRow < landingAxisRow;
}

export function advanceActivePuyoVisuals(game: PuyoGameState, dt: number, columnSlideMs: number): void {
  if (!game.pair) return;
  const columnDelta = game.pair.axisColumn - game.pair.visualAxisColumn;
  if (columnDelta === 0) return;
  const maxStep = dt / Math.max(1, columnSlideMs);
  game.pair.visualAxisColumn += Math.sign(columnDelta) * Math.min(Math.abs(columnDelta), maxStep);
}

export function settlePuyoPair(
  game: PuyoGameState,
  columns: number,
  rows: number,
  chainTarget: number,
  colors: string[],
  now: number,
  clearDurationMs: number,
  gravityResolveDelayMs: number,
  boardFallMsPerRow: number,
  spawnDelayMs: number
): void {
  if (!game.pair) return;
  for (const cell of activePairCells(game.pair)) {
    if (cell.row < 0) {
      game.gameOver = true;
      return;
    }
    game.board[cell.row]![cell.column] = cell.color;
  }
  game.pair = null;
  game.lockStartedAt = 0;
  updatePuyoGameOver(game, columns);
  const gravity = applyPuyoGravity(game.board, columns, rows);
  mergeFallingPuyoCells(game, gravity);
  const gravityDelayMs = gravityDelayFor(gravity.maxDistance, gravityResolveDelayMs, boardFallMsPerRow);
  const clearCells = findClearCells(game.board, columns, rows, chainTarget);
  if (clearCells.size > 0) {
    game.resolving = true;
    game.chain = 0;
    if (gravity.maxDistance > 0) {
      game.clearingCells = new Set();
      game.nextResolveAt = now + gravityDelayMs;
    } else {
      game.chain = 1;
      game.clearingCells = clearCells;
      game.clearStartedAt = now;
      game.nextResolveAt = now + clearDurationMs;
    }
    return;
  }
  game.chain = 0;
  game.score += 10;
  game.spawnReadyAt = now + spawnDelayMs;
}

export function advancePuyoResolution(
  game: PuyoGameState,
  columns: number,
  rows: number,
  chainTarget: number,
  colors: string[],
  now: number,
  clearDurationMs: number,
  gravityResolveDelayMs: number,
  boardFallMsPerRow: number,
  spawnDelayMs: number
): void {
  if (!game.resolving || game.fallingCells.size > 0 || now < game.nextResolveAt) return;
  if (game.clearingCells.size > 0) {
    const coloredClearedCount = countColoredClearingCells(game.board, game.clearingCells);
    for (const key of game.clearingCells) {
      const [rowText, columnText] = key.split(":");
      game.board[Number(rowText)]![Number(columnText)] = null;
    }
    game.score += game.chain * game.chain * coloredClearedCount * 50;
    game.pendingAttack += attackForClear(coloredClearedCount, game.chain);
    game.clearingCells = new Set();
    const gravity = applyPuyoGravity(game.board, columns, rows);
    mergeFallingPuyoCells(game, gravity);
    game.nextResolveAt = now + gravityDelayFor(gravity.maxDistance, gravityResolveDelayMs, boardFallMsPerRow);
    return;
  }
  const nextClearCells = findClearCells(game.board, columns, rows, chainTarget);
  if (nextClearCells.size > 0) {
    game.chain = game.chain > 0 ? game.chain + 1 : 1;
    game.clearingCells = nextClearCells;
    game.clearStartedAt = now;
    game.nextResolveAt = now + clearDurationMs;
    return;
  }
  game.resolving = false;
  game.chain = 0;
  game.spawnReadyAt = now + spawnDelayMs;
}

export function advancePuyoSpawnDelay(game: PuyoGameState, columns: number, rows: number, colors: string[], now: number): void {
  if (game.resolving || game.pair || game.fallingCells.size > 0 || game.spawnReadyAt <= 0 || now < game.spawnReadyAt) return;
  if (game.incomingOjama > 0) {
    const ojamaCount = game.incomingOjama;
    game.incomingOjama = 0;
    addOjamaPuyo(game, columns, rows, ojamaCount, game.rngState);
    game.rngState = hashNumber(game.rngState + ojamaCount * 53 + 7);
    game.spawnReadyAt = now + 180;
    return;
  }
  if (game.gameOver) return;
  game.spawnReadyAt = 0;
  spawnNextPuyoPair(game, columns, rows, colors);
}

export function popPuyoAttack(game: PuyoGameState): number {
  const attack = game.pendingAttack;
  game.pendingAttack = 0;
  return attack;
}

export function queueOjamaPuyo(game: PuyoGameState, count: number): void {
  if (count <= 0) return;
  game.incomingOjama += count;
  if (game.gameOver && !game.pair && !game.resolving && game.spawnReadyAt <= 0) {
    game.spawnReadyAt = 1;
  }
}

export function dropTestOjamaPuyo(game: PuyoGameState, columns: number, rows: number, count: number): void {
  if (count <= 0) return;
  addOjamaPuyo(game, columns, rows, count, game.rngState);
  game.rngState = hashNumber(game.rngState + count * 71 + 5);
}

export function chooseCpuPuyoMove(game: PuyoGameState, columns: number, rows: number, chainTarget: number): PuyoCpuMove | null {
  if (!game.pair) return null;
  const currentMoves = simulatePuyoMoves(game.board, game.pair, columns, rows, chainTarget);
  if (currentMoves.length === 0) return null;
  let bestMove: PuyoMoveSimulation | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const move of currentMoves) {
    const nextPair = createPuyoPair(columns, game.nextPair.axisColor, game.nextPair.childColor);
    const nextMoves = simulatePuyoMoves(move.board, nextPair, columns, rows, chainTarget);
    const nextBestScore = Math.max(0, ...nextMoves.map((nextMove) => nextMove.score));
    const score = move.score + nextBestScore * 0.42;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove?.move ?? null;
}

function addOjamaPuyo(game: PuyoGameState, columns: number, rows: number, count: number, seed: number): void {
  if (count <= 0) return;
  const columnOrder = Array.from({ length: columns }, (_, column) => column).sort((left, right) => {
    const leftHash = hashNumber(seed + left * 37 + count * 11);
    const rightHash = hashNumber(seed + right * 37 + count * 11);
    return leftHash - rightHash;
  });
  let remaining = Math.min(count, columns * 2);
  while (remaining > 0) {
    let placedThisPass = false;
    for (const column of columnOrder) {
      if (remaining <= 0) break;
      const row = findTopEmptyRow(game.board, column, rows);
      if (row === -1) {
        game.gameOver = true;
        continue;
      }
      game.board[row]![column] = OJAMA_PUYO_COLOR;
      remaining -= 1;
      placedThisPass = true;
    }
    if (!placedThisPass) break;
  }
  mergeFallingPuyoCells(game, applyPuyoGravity(game.board, columns, rows));
  updatePuyoGameOver(game, columns);
}

export function advanceBoardPuyoFalls(game: PuyoGameState, dt: number, boardFallMsPerRow: number): void {
  if (game.fallingCells.size === 0) return;
  const rowsPerFrame = dt / Math.max(1, boardFallMsPerRow);
  for (const [key, visualRow] of [...game.fallingCells]) {
    const [targetRowText] = key.split(":");
    const targetRow = Number(targetRowText);
    const nextVisualRow = Math.min(targetRow, visualRow + rowsPerFrame);
    if (nextVisualRow >= targetRow) {
      game.fallingCells.delete(key);
    } else {
      game.fallingCells.set(key, nextVisualRow);
    }
  }
}

function emptyPuyoBoard(columns: number, rows: number): PuyoBoard {
  return Array.from({ length: rows }, () => Array.from<PuyoCell>({ length: columns }).fill(null));
}

function createPuyoPair(columns: number, axisColor: string, childColor: string): PuyoPair {
  const spawnColumn = Math.max(1, Math.min(columns - 2, Math.floor(columns / 2)));
  return {
    axisColumn: spawnColumn,
    axisRow: 1,
    visualAxisColumn: spawnColumn,
    visualAxisRow: 1,
    rotation: 0,
    axisColor,
    childColor
  };
}

function createRandomPuyoPair(columns: number, colors: string[], rngState: number): { pair: PuyoPair; rngState: number } {
  const axis = nextRandomInt(rngState, colors.length);
  const child = nextRandomInt(axis.rngState, colors.length);
  return {
    pair: createPuyoPair(columns, colors[axis.value]!, colors[child.value]!),
    rngState: child.rngState
  };
}

function activePairCells(pair: PuyoPair): Array<{ column: number; row: number; color: string; alpha: number }> {
  const child = childOffset(pair.rotation);
  return [
    { column: pair.axisColumn, row: pair.axisRow, color: pair.axisColor, alpha: 1 },
    { column: pair.axisColumn + child.column, row: pair.axisRow + child.row, color: pair.childColor, alpha: 0.96 }
  ];
}

function childOffset(rotation: PuyoPair["rotation"]): { column: number; row: number } {
  if (rotation === 0) return { column: 0, row: -1 };
  if (rotation === 1) return { column: 1, row: 0 };
  if (rotation === 2) return { column: 0, row: 1 };
  return { column: -1, row: 0 };
}

function canPlacePuyoPair(board: PuyoBoard, pair: PuyoPair, columns: number, rows: number): boolean {
  return activePairCells(pair).every((cell) => canPlacePuyoCell(board, cell.column, cell.row, columns, rows));
}

function canPlacePuyoCell(board: PuyoBoard, column: number, row: number, columns: number, rows: number): boolean {
  if (column < 0 || column >= columns || row >= rows) return false;
  if (row < 0) return true;
  return !board[row]?.[column];
}

function findLandingAxisRow(board: PuyoBoard, pair: PuyoPair, columns: number, rows: number): number {
  let landingAxisRow = pair.axisRow;
  while (canPlacePuyoPair(board, { ...pair, axisRow: landingAxisRow + 1 }, columns, rows)) {
    landingAxisRow += 1;
  }
  return landingAxisRow;
}

function simulatePuyoMoves(board: PuyoBoard, pair: PuyoPair, columns: number, rows: number, chainTarget: number): PuyoMoveSimulation[] {
  const moves: PuyoMoveSimulation[] = [];
  for (let rotation = 0; rotation < 4; rotation += 1) {
    for (let axisColumn = -1; axisColumn <= columns; axisColumn += 1) {
      const candidate = {
        ...pair,
        axisColumn,
        axisRow: -1,
        visualAxisColumn: axisColumn,
        visualAxisRow: -1,
        rotation: rotation as PuyoPair["rotation"]
      };
      if (!canPlacePuyoPair(board, candidate, columns, rows)) continue;
      const landingAxisRow = findLandingAxisRow(board, candidate, columns, rows);
      const landed = { ...candidate, axisRow: landingAxisRow, visualAxisRow: landingAxisRow };
      if (activePairCells(landed).some((cell) => cell.row < 0)) continue;
      const simulation = simulatePuyoPlacement(board, landed, columns, rows, chainTarget);
      moves.push({
        ...simulation,
        move: {
          targetColumn: axisColumn,
          targetRotation: rotation as PuyoPair["rotation"]
        }
      });
    }
  }
  return moves;
}

function simulatePuyoPlacement(board: PuyoBoard, pair: PuyoPair, columns: number, rows: number, chainTarget: number): Omit<PuyoMoveSimulation, "move"> {
  const simulatedBoard = clonePuyoBoard(board);
  for (const cell of activePairCells(pair)) {
    if (cell.row < 0 || cell.column < 0 || cell.column >= columns || cell.row >= rows) {
      return { board: simulatedBoard, chain: 0, coloredCleared: 0, score: -100000, gameOver: true };
    }
    simulatedBoard[cell.row]![cell.column] = cell.color;
  }
  let chain = 0;
  let coloredCleared = 0;
  while (true) {
    const clearCells = findClearCells(simulatedBoard, columns, rows, chainTarget);
    if (clearCells.size === 0) break;
    chain += 1;
    coloredCleared += countColoredClearingCells(simulatedBoard, clearCells);
    for (const key of clearCells) {
      const [rowText, columnText] = key.split(":");
      simulatedBoard[Number(rowText)]![Number(columnText)] = null;
    }
    applyPuyoGravity(simulatedBoard, columns, rows);
  }
  return {
    board: simulatedBoard,
    chain,
    coloredCleared,
    score: evaluatePuyoBoard(simulatedBoard, columns, rows, chain, coloredCleared),
    gameOver: isBoardDangerous(simulatedBoard, columns)
  };
}

function evaluatePuyoBoard(board: PuyoBoard, columns: number, rows: number, chain: number, coloredCleared: number): number {
  const heights = Array.from({ length: columns }, (_, column) => getColumnHeight(board, column, rows));
  const maxHeight = Math.max(...heights);
  const aggregateHeight = heights.reduce((total, height) => total + height, 0);
  const bumpiness = heights.slice(1).reduce((total, height, index) => total + Math.abs(height - heights[index]!), 0);
  const holes = countBoardHoles(board, columns, rows);
  const colorLinks = countColorLinks(board, columns, rows);
  const nearGroups = countNearClearGroups(board, columns, rows);
  const dangerPenalty = maxHeight >= rows - 2 ? 900 : maxHeight >= rows - 4 ? 260 : 0;
  return (
    chain * chain * 1500 +
    coloredCleared * 120 +
    nearGroups * 95 +
    colorLinks * 18 -
    aggregateHeight * 17 -
    bumpiness * 32 -
    holes * 180 -
    dangerPenalty
  );
}

function clonePuyoBoard(board: PuyoBoard): PuyoBoard {
  return board.map((row) => [...row]);
}

function getColumnHeight(board: PuyoBoard, column: number, rows: number): number {
  const firstFilledRow = board.findIndex((row) => Boolean(row[column]));
  return firstFilledRow === -1 ? 0 : rows - firstFilledRow;
}

function countBoardHoles(board: PuyoBoard, columns: number, rows: number): number {
  let holes = 0;
  for (let column = 0; column < columns; column += 1) {
    let foundBlock = false;
    for (let row = 0; row < rows; row += 1) {
      if (board[row]?.[column]) {
        foundBlock = true;
      } else if (foundBlock) {
        holes += 1;
      }
    }
  }
  return holes;
}

function countColorLinks(board: PuyoBoard, columns: number, rows: number): number {
  let links = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const color = board[row]?.[column];
      if (!color || color === OJAMA_PUYO_COLOR) continue;
      if (column + 1 < columns && board[row]?.[column + 1] === color) links += 1;
      if (row + 1 < rows && board[row + 1]?.[column] === color) links += 1;
    }
  }
  return links;
}

function countNearClearGroups(board: PuyoBoard, columns: number, rows: number): number {
  const visited = new Set<string>();
  let nearGroups = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const color = board[row]?.[column];
      const key = `${row}:${column}`;
      if (!color || color === OJAMA_PUYO_COLOR || visited.has(key)) continue;
      const group = floodPuyoGroup(board, columns, rows, column, row, color, visited);
      if (group.length === 3) nearGroups += 3;
      if (group.length === 2) nearGroups += 1;
    }
  }
  return nearGroups;
}

function isBoardDangerous(board: PuyoBoard, columns: number): boolean {
  return isTopCenterBlocked(board, columns);
}

function spawnNextPuyoPair(game: PuyoGameState, columns: number, rows: number, colors: string[]): void {
  if (isTopCenterBlocked(game.board, columns)) {
    game.gameOver = true;
    return;
  }
  game.pair = {
    ...createPuyoPair(columns, game.nextPair.axisColor, game.nextPair.childColor),
    axisColor: game.nextPair.axisColor,
    childColor: game.nextPair.childColor
  };
  const next = createRandomPuyoPair(columns, colors, game.rngState);
  game.nextPair = next.pair;
  game.rngState = next.rngState;
  game.gameOver = isTopCenterBlocked(game.board, columns) || !canPlacePuyoPair(game.board, game.pair, columns, rows);
}

function updatePuyoGameOver(game: PuyoGameState, columns: number): void {
  if (isTopCenterBlocked(game.board, columns)) game.gameOver = true;
}

function isTopCenterBlocked(board: PuyoBoard, columns: number): boolean {
  const rightCenter = Math.max(0, Math.min(columns - 1, Math.floor(columns / 2)));
  const leftCenter = Math.max(0, rightCenter - 1);
  return Boolean(board[0]?.[leftCenter] || board[0]?.[rightCenter]);
}

function findClearCells(board: PuyoBoard, columns: number, rows: number, chainTarget: number): Set<string> {
  const visited = new Set<string>();
  const clearCells = new Set<string>();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const color = board[row]?.[column];
      const key = `${row}:${column}`;
      if (!color || color === OJAMA_PUYO_COLOR || visited.has(key)) continue;
      const group = floodPuyoGroup(board, columns, rows, column, row, color, visited);
      if (group.length >= chainTarget) {
        for (const item of group) {
          clearCells.add(`${item.row}:${item.column}`);
          addAdjacentOjamaCells(board, columns, rows, item.column, item.row, clearCells);
        }
      }
    }
  }
  return clearCells;
}

function addAdjacentOjamaCells(board: PuyoBoard, columns: number, rows: number, column: number, row: number, clearCells: Set<string>): void {
  for (const neighbor of [
    { column: column + 1, row },
    { column: column - 1, row },
    { column, row: row + 1 },
    { column, row: row - 1 }
  ]) {
    if (neighbor.column < 0 || neighbor.column >= columns || neighbor.row < 0 || neighbor.row >= rows) continue;
    if (board[neighbor.row]?.[neighbor.column] === OJAMA_PUYO_COLOR) {
      clearCells.add(`${neighbor.row}:${neighbor.column}`);
    }
  }
}

function countColoredClearingCells(board: PuyoBoard, clearingCells: Set<string>): number {
  let count = 0;
  for (const key of clearingCells) {
    const [rowText, columnText] = key.split(":");
    const color = board[Number(rowText)]?.[Number(columnText)];
    if (color && color !== OJAMA_PUYO_COLOR) count += 1;
  }
  return count;
}

function findTopEmptyRow(board: PuyoBoard, column: number, rows: number): number {
  for (let row = 0; row < rows; row += 1) {
    if (!board[row]?.[column]) return row;
  }
  return -1;
}

function attackForClear(clearedCount: number, chain: number): number {
  return Math.max(1, Math.floor(clearedCount / 4) + Math.max(0, chain - 1) * 2);
}

function normalizeRngSeed(seed: number): number {
  return (Math.abs(Math.floor(seed)) || 1) >>> 0;
}

function nextRandomInt(rngState: number, max: number): { value: number; rngState: number } {
  const nextState = hashNumber(rngState + 0x9e3779b9);
  return {
    value: nextState % Math.max(1, max),
    rngState: nextState
  };
}

function hashNumber(value: number): number {
  let hash = value >>> 0;
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return hash >>> 0;
}

function floodPuyoGroup(
  board: PuyoBoard,
  columns: number,
  rows: number,
  startColumn: number,
  startRow: number,
  color: string,
  visited: Set<string>
): Array<{ column: number; row: number }> {
  const group: Array<{ column: number; row: number }> = [];
  const stack = [{ column: startColumn, row: startRow }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const key = `${current.row}:${current.column}`;
    if (visited.has(key)) continue;
    if (current.column < 0 || current.column >= columns || current.row < 0 || current.row >= rows) continue;
    if (board[current.row]?.[current.column] !== color) continue;
    visited.add(key);
    group.push(current);
    stack.push(
      { column: current.column + 1, row: current.row },
      { column: current.column - 1, row: current.row },
      { column: current.column, row: current.row + 1 },
      { column: current.column, row: current.row - 1 }
    );
  }
  return group;
}

function applyPuyoGravity(board: PuyoBoard, columns: number, rows: number): PuyoGravityResult {
  const fallingCells = new Map<string, number>();
  let maxDistance = 0;
  for (let column = 0; column < columns; column += 1) {
    const filled: Array<{ color: string; sourceRow: number }> = [];
    for (let row = rows - 1; row >= 0; row -= 1) {
      const color = board[row]?.[column];
      if (color) filled.push({ color, sourceRow: row });
    }
    for (let row = rows - 1; row >= 0; row -= 1) {
      const item = filled[rows - 1 - row] ?? null;
      board[row]![column] = item?.color ?? null;
      if (item && item.sourceRow !== row) {
        fallingCells.set(`${row}:${column}`, item.sourceRow);
        maxDistance = Math.max(maxDistance, row - item.sourceRow);
      }
    }
  }
  return { fallingCells, maxDistance };
}

function mergeFallingPuyoCells(game: PuyoGameState, gravity: PuyoGravityResult): void {
  for (const [key, sourceRow] of gravity.fallingCells) {
    game.fallingCells.set(key, sourceRow);
  }
}

function gravityDelayFor(maxDistance: number, fallbackDelayMs: number, boardFallMsPerRow: number): number {
  return maxDistance > 0 ? maxDistance * boardFallMsPerRow + 90 : fallbackDelayMs;
}

function seededPuyoCells(columns: number, rows: number, fillRows: number, seed: number, colors: string[]): Array<{ column: number; row: number; color: string }> {
  const cells: Array<{ column: number; row: number; color: string }> = [];
  const countRows = Math.min(fillRows, rows - 2);
  for (let rowOffset = 0; rowOffset < countRows; rowOffset += 1) {
    for (let column = 0; column < columns; column += 1) {
      if ((column + rowOffset + seed) % 5 === 0) continue;
      cells.push({
        column,
        row: rows - 1 - rowOffset,
        color: colors[(column * 3 + rowOffset + seed) % colors.length]!
      });
    }
  }
  return cells;
}
