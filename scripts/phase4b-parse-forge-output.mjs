// scripts/phase4b-parse-forge-output.mjs
//
// Parse Forge Simulation Mode stdout into MatchGameResult[].
//
// The stdout format (verified from forge-game/src/main/java/forge/game/
// GameLogEntry.java @ forge-2.0.14):
//
//   <caption>: <message>   ← one line per GameLogEntry
//   ...
//   Game Result: Game <N> ended in <ms> ms. <NAME> has won!
//   Game Result: Game <N> ended in a Draw! Took <ms> ms.
//
// GameLogEntry captions include: Turn, Mulligan, Land, Life, Damage,
// Combat, Zone Change, Resolve Stack, Add To Stack, Mana, Phase,
// Information, Discard, Replacement Effect, Game Outcome, Match Result.
//
// Note the log for each game is emitted with Collections.reverse(),
// so within a game the OLDEST entry appears LAST. We do not depend on
// order — we just count turn markers.
//
// Usage:
//   node scripts/phase4b-parse-forge-output.mjs <log.txt> [--json]

import { readFileSync } from 'node:fs'

/**
 * @typedef {{
 *   game_index: number,
 *   outcome: 'p1_win' | 'p2_win' | 'draw' | 'unknown',
 *   winner_name: string | null,
 *   turns: number | null,
 *   duration_ms: number | null,
 *   reason: string,
 *   final_life: null | { p1: number, p2: number },
 *   mulligans: null | { p1: number, p2: number },
 *   raw_log_line_count: number,
 * }} ForgeGameResult
 */

export function parseForgeOutput(text, seatNames) {
  const lines = text.split(/\r?\n/)
  const games = []
  let currentBuf = []
  let gameIndex = 0

  // Collect every "Game Result:" line's INDEX first, so we can split
  // the log into per-game chunks in one pass.
  for (const line of lines) {
    currentBuf.push(line)
    if (/^Game Result:/.test(line)) {
      games.push(parseGame(currentBuf, gameIndex++, seatNames))
      currentBuf = []
    }
  }
  return games
}

/** @returns {ForgeGameResult} */
function parseGame(buf, gameIndex, seatNames) {
  const p1 = seatNames?.[0] ?? null
  const p2 = seatNames?.[1] ?? null

  let outcome = 'unknown'
  let winnerName = null
  let durationMs = null
  let reason = ''
  const resultLine = buf.find((l) => /^Game Result:/.test(l))
  if (resultLine) {
    reason = resultLine
    // Draw variant.
    const draw = resultLine.match(/^Game Result: Game (\d+) ended in a Draw!\s*Took (\d+) ms\.?/i)
    if (draw) {
      outcome = 'draw'
      durationMs = Number(draw[2])
    } else {
      const win = resultLine.match(/^Game Result: Game (\d+) ended in (\d+) ms\.\s+(.+?) has won!/i)
      if (win) {
        durationMs = Number(win[2])
        winnerName = win[3].trim()
        // Map to p1/p2 by seat name when known. Forge's AI player
        // names look like "Ai(1)-DeckName" / "Ai(2)-DeckName".
        if (p1 && matchesSeat(winnerName, p1, 1)) outcome = 'p1_win'
        else if (p2 && matchesSeat(winnerName, p2, 2)) outcome = 'p2_win'
        else if (winnerName.includes('(1)')) outcome = 'p1_win'
        else if (winnerName.includes('(2)')) outcome = 'p2_win'
      }
    }
  }

  // Turns: count "Turn: <name>'s turn N" — the highest N wins. Fall
  // back to counting distinct turn-transition markers.
  let maxTurn = 0
  let mullP1 = 0, mullP2 = 0
  for (const line of buf) {
    const t = line.match(/^Turn:\s+.+?turn\s+(\d+)/i)
    if (t) maxTurn = Math.max(maxTurn, Number(t[1]))
    if (/^Mulligan:/i.test(line)) {
      if (p1 && line.includes(p1)) mullP1++
      else if (p2 && line.includes(p2)) mullP2++
    }
  }

  return {
    game_index: gameIndex,
    outcome,
    winner_name: winnerName,
    turns: maxTurn > 0 ? maxTurn : null,
    duration_ms: durationMs,
    reason,
    final_life: null,   // Forge log doesn't emit final life explicitly.
    mulligans: (mullP1 + mullP2 > 0) ? { p1: mullP1, p2: mullP2 } : null,
    raw_log_line_count: buf.length,
  }
}

function matchesSeat(winnerName, seatName, seatIndex) {
  // Forge's default naming is `Ai(<i>)-<DeckName>`. Match the seat
  // number OR by deck name.
  if (winnerName.includes(`(${seatIndex})`)) return true
  if (seatName && winnerName.toLowerCase().includes(seatName.toLowerCase())) return true
  return false
}

/** Aggregate a list of per-game results into a match summary. */
export function aggregate(games) {
  const p1_wins = games.filter((g) => g.outcome === 'p1_win').length
  const p2_wins = games.filter((g) => g.outcome === 'p2_win').length
  const draws = games.filter((g) => g.outcome === 'draw').length
  const unknown = games.filter((g) => g.outcome === 'unknown').length
  const durations = games.map((g) => g.duration_ms).filter((n) => n != null)
  const turns = games.map((g) => g.turns).filter((n) => n != null)
  return {
    total: games.length,
    p1_wins, p2_wins, draws, unknown,
    win_rate_p1: games.length > 0 ? (p1_wins / games.length) : 0,
    avg_turns: turns.length > 0 ? (turns.reduce((a, b) => a + b, 0) / turns.length) : null,
    avg_duration_ms: durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length) : null,
  }
}

// CLI entry.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('phase4b-parse-forge-output.mjs')) {
  const path = process.argv[2]
  if (!path) { console.error('usage: node phase4b-parse-forge-output.mjs <log.txt> [--json] [--seat1 NAME --seat2 NAME]'); process.exit(2) }
  const text = readFileSync(path, 'utf8')
  const seatArgs = process.argv.filter((a, i) => process.argv[i - 1] === '--seat1' || process.argv[i - 1] === '--seat2')
  const seatNames = seatArgs.length === 2 ? seatArgs : null
  const games = parseForgeOutput(text, seatNames)
  const agg = aggregate(games)
  const wantJson = process.argv.includes('--json')
  if (wantJson) {
    console.log(JSON.stringify({ games, aggregate: agg }, null, 2))
  } else {
    console.log(`Parsed ${games.length} game(s). p1=${agg.p1_wins} p2=${agg.p2_wins} draw=${agg.draws} unknown=${agg.unknown}`)
    console.log(`avg turns=${agg.avg_turns?.toFixed(1) ?? 'n/a'}, avg duration=${agg.avg_duration_ms?.toFixed(0) ?? 'n/a'}ms`)
  }
}
