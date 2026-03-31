/* =====================================================
   민사친76 배드민턴 매칭 시스템 · 메인 스크립트
   ===================================================== */

/* ─────────────────────────────────────────────────────
   Supabase 설정
   ───────────────────────────────────────────────────── */
const SUPABASE_URL = 'https://kdjgpsxbdceqdeoabtky.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtkamdwc3hiZGNlcWRlb2FidGt5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjY1MjIsImV4cCI6MjA5MDQ0MjUyMn0.WQ4fDV3TW9E7sKfTrE3XM-kn0RkowPFmuPXeGluMc4E';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ─────────────────────────────────────────────────────
   고정 대진표 구조 (라운드 로빈 6팀)
   ───────────────────────────────────────────────────── */
const BRACKET_STRUCTURE = [
  { set: 1, matches: [{ court: 'A', posA: 1, posB: 6 }, { court: 'B', posA: 2, posB: 5 }, { court: 'C', posA: 3, posB: 4 }] },
  { set: 2, matches: [{ court: 'A', posA: 1, posB: 5 }, { court: 'B', posA: 6, posB: 4 }, { court: 'C', posA: 2, posB: 3 }] },
  { set: 3, matches: [{ court: 'A', posA: 1, posB: 4 }, { court: 'B', posA: 5, posB: 3 }, { court: 'C', posA: 6, posB: 2 }] },
  { set: 4, matches: [{ court: 'A', posA: 1, posB: 3 }, { court: 'B', posA: 4, posB: 2 }, { court: 'C', posA: 5, posB: 6 }] },
  { set: 5, matches: [{ court: 'A', posA: 1, posB: 2 }, { court: 'B', posA: 3, posB: 6 }, { court: 'C', posA: 4, posB: 5 }] },
];

/* ─────────────────────────────────────────────────────
   상태 관리
   ───────────────────────────────────────────────────── */
let state = {
  teams:       [],   // DB teams
  players:     [],   // DB players
  matches:     [],   // DB matches (대진표)
  assignments: [],   // DB game_assignments
  currentView: 'match',
  currentSet:  1,
  winScore:    25,
  editingTeamId:   null,
  editingPlayerId: null,
  selectCtx: null,   // { matchId, teamId, slot, currentPlayerId }
};

/* ─────────────────────────────────────────────────────
   데이터 로딩
   ───────────────────────────────────────────────────── */
async function loadAll() {
  const [t, p, m, a] = await Promise.all([
    sb.from('teams').select('*').order('position', { nullsFirst: false }),
    sb.from('players').select('*').order('created_at'),
    sb.from('matches').select('*').order('set_number').order('court'),
    sb.from('game_assignments').select('*'),
  ]);
  if (t.error) throw t.error;
  if (p.error) throw p.error;

  state.teams       = t.data || [];
  state.players     = p.data || [];
  state.matches     = m.data || [];
  state.assignments = a.data || [];
}

/* ─────────────────────────────────────────────────────
   헬퍼 함수
   ───────────────────────────────────────────────────── */
const getTeamByPosition = pos  => state.teams.find(t => t.position === pos);
const getTeamById       = id   => state.teams.find(t => t.id === id);
const getPlayerById     = id   => state.players.find(p => p.id === id);
const getTeamPlayers    = tid  => state.players.filter(p => p.team_id === tid && p.is_active);
const getUnassigned = () => state.players
  .filter(p => !p.team_id && p.is_active)
  .sort((a, b) => {
    const gA = a.gender === 'male' ? 0 : 1;
    const gB = b.gender === 'male' ? 0 : 1;
    if (gA !== gB) return gA - gB;
    return a.name.localeCompare(b.name, 'ko');
  });

function getMatchAssignment(matchId, teamId) {
  return state.assignments.find(a => a.match_id === matchId && a.team_id === teamId);
}

const PLAYER_SCORE_TABLE = {
  male:   { A: 5,   B: 4,   C: 3,   D: 2,   E: 1,   _default: 2 },
  female: { A: 3.5, B: 2.5, C: 1.5, D: 1,   E: 0.5, _default: 1 },
};
function getPlayerScore(p) {
  const table = PLAYER_SCORE_TABLE[p.gender] || PLAYER_SCORE_TABLE.male;
  return table[p.level] ?? table._default;
}
function getTeamScore(teamId) {
  return getTeamPlayers(teamId).reduce((sum, p) => sum + getPlayerScore(p), 0);
}

function getPlayerGameCount(playerId) {
  return state.assignments.filter(a =>
    a.player1_id === playerId || a.player2_id === playerId
  ).length;
}

function getSetStatus(setNum) {
  const sm = state.matches.filter(m => m.set_number === setNum);
  if (!sm.length) return 'none';
  return sm.every(m => m.status === 'completed') ? 'completed' : 'pending';
}

/* ─────────────────────────────────────────────────────
   네비게이션
   ───────────────────────────────────────────────────── */
function navigate(view) {
  state.currentView = view;

  // 사이드바 활성화
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById('nav-' + view);
  if (navEl) navEl.classList.add('active');

  // 뷰 전환
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');

  renderView(view);
}

function renderView(view) {
  switch (view) {
    case 'teams':   renderTeams();   break;
    case 'match':   renderMatch();   break;
    case 'bracket': renderBracket(); break;
    case 'ranking': renderRanking(); break;
  }
}

/* ─────────────────────────────────────────────────────
   팀 CRUD
   ───────────────────────────────────────────────────── */
/** 다음 사용 가능한 포지션 번호 반환 (1~6) */
function _nextPosition() {
  const used = new Set(state.teams.map(t => t.position).filter(Boolean));
  for (let i = 1; i <= 6; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

async function deleteAllGuests() {
  const guests = state.players.filter(p => p.is_guest);
  if (!guests.length) { showToast('등록된 게스트가 없습니다', 'error'); return; }

  // 경기에 배정된 게스트가 있으면 삭제 불가
  const guestIds = new Set(guests.map(p => p.id));
  const assignedGuestIds = state.assignments.filter(
    a => guestIds.has(a.player1_id) || guestIds.has(a.player2_id)
  );
  if (assignedGuestIds.length > 0) {
    showToast('대진표 생성 후 경기에 배정된 게스트는 삭제할 수 없습니다.\n팀 세팅 초기화 후 삭제하세요.', 'error');
    return;
  }

  openConfirm(
    `게스트 선수 ${guests.length}명을 모두 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
    async () => {
      const ids = guests.map(p => p.id);
      const { error } = await sb.from('players').delete().in('id', ids);
      if (error) { showToast('삭제 실패: ' + error.message, 'error'); return; }
      await loadAll();
      renderTeams();
      showToast(`게스트 ${guests.length}명 삭제 완료`);
    }
  );
}

async function resetTeamSettings() {
  if (!state.teams.length) { showToast('등록된 팀이 없습니다', 'error'); return; }

  // 선수만 미배정으로 전환 (팀 유지)
  const resetPlayersOnly = async () => {
    const { error: pe } = await sb.from('players')
      .update({ team_id: null, is_captain: false })
      .not('id', 'is', null);
    if (pe) { showToast('초기화 실패: ' + pe.message, 'error'); return; }
    if (state.matches.length) {
      await sb.from('matches').delete().gte('set_number', 1);
    }
    await loadAll();
    state.currentSet = 1;
    renderTeams();
    showToast('선수 배정 초기화 완료 (팀 유지)');
  };

  // 팀까지 모두 삭제
  const resetAll = async () => {
    const { error: pe } = await sb.from('players')
      .update({ team_id: null, is_captain: false })
      .not('id', 'is', null);
    if (pe) { showToast('초기화 실패: ' + pe.message, 'error'); return; }
    if (state.matches.length) {
      await sb.from('matches').delete().gte('set_number', 1);
    }
    const { error: te } = await sb.from('teams').delete().not('id', 'is', null);
    if (te) { showToast('팀 삭제 실패: ' + te.message, 'error'); return; }
    await loadAll();
    state.currentSet = 1;
    renderTeams();
    showToast('팀 세팅 전체 초기화 완료');
  };

  openConfirm(
    `초기화 방식을 선택하세요.\n\n• 선수만 초기화: 팀은 유지, 모든 선수를 미배정으로 전환\n• 전체 초기화: 팀·선수 배정·대진표 모두 삭제`,
    resetAll,
    '선수만 초기화',
    resetPlayersOnly
  );
}

async function openAddTeam() {
  if (state.teams.length >= 6) { showToast('최대 6팀까지 등록 가능합니다', 'error'); return; }
  const nextPos = _nextPosition();
  const name    = `${nextPos}팀`;
  const { error } = await sb.from('teams').insert({ name, position: nextPos });
  if (error) { showToast('팀 생성 실패: ' + error.message, 'error'); return; }
  await loadAll();
  renderTeams();
  showToast(`${name} 생성 완료`);
}

function openEditTeam(teamId) {
  const team = getTeamById(teamId);
  state.editingTeamId = teamId;
  document.getElementById('modal-team-title').textContent = '팀 수정';
  document.getElementById('team-name-input').value = team.name;
  document.getElementById('team-position-wrap').style.display = 'block';
  document.getElementById('team-auto-pos-hint').textContent = '';
  document.getElementById('team-position-input').value = team.position || '';
  _updatePositionOpts(team.position);
  showModal('modal-team');
}

function _updatePositionOpts(currentPos) {
  const used = state.teams
    .filter(t => t.position && t.position !== currentPos)
    .map(t => t.position);
  const sel = document.getElementById('team-position-input');
  Array.from(sel.options).forEach(opt => {
    if (!opt.value) { opt.textContent = '미배정'; opt.disabled = false; return; }
    const v = parseInt(opt.value);
    opt.disabled  = used.includes(v);
    opt.textContent = used.includes(v) ? `${v}번 (사용중)` : `${v}번`;
  });
}

async function saveTeam() {
  // 팀 수정만 처리 (추가는 openAddTeam에서 직접 처리)
  if (!state.editingTeamId) return;
  const name = document.getElementById('team-name-input').value.trim();
  if (!name) { showToast('팀명을 입력하세요', 'error'); return; }
  const pos  = document.getElementById('team-position-input').value;
  const data = { name, position: pos ? parseInt(pos) : null };
  const { error } = await sb.from('teams').update(data).eq('id', state.editingTeamId);
  if (error) { showToast('저장 실패: ' + error.message, 'error'); return; }
  closeAllModals();
  await loadAll();
  renderView(state.currentView);
  showToast('팀 저장 완료');
}

function openDeleteTeam(teamId) {
  const team = getTeamById(teamId);
  openConfirm(
    `"${team.name}" 팀을 삭제할까요?\n소속 선수들은 미배정 상태로 변경됩니다.`,
    async () => {
      const { error } = await sb.from('teams').delete().eq('id', teamId);
      if (error) { showToast('삭제 실패', 'error'); return; }
      await loadAll();
      renderView(state.currentView);
      showToast('팀 삭제 완료');
    }
  );
}

/* ─────────────────────────────────────────────────────
   선수 CRUD
   ───────────────────────────────────────────────────── */
function openAddPlayer(teamId = null) {
  state.editingPlayerId = null;
  document.getElementById('modal-player-title').textContent = '선수 등록';
  document.getElementById('player-name-input').value = '';
  document.getElementById('player-gender-input').value = 'male';
  document.getElementById('player-level-input').value  = 'C';
  document.getElementById('player-captain-input').checked = false;
  document.getElementById('player-guest-input').checked   = false;
  document.getElementById('btn-delete-player').style.display = 'none';
  _updatePlayerTeamOpts(teamId);
  showModal('modal-player');
  document.getElementById('player-name-input').focus();
}

function openEditPlayer(playerId) {
  const p = getPlayerById(playerId);
  state.editingPlayerId = playerId;
  document.getElementById('modal-player-title').textContent = '선수 수정';
  document.getElementById('player-name-input').value = p.name;
  document.getElementById('player-gender-input').value = p.gender;
  document.getElementById('player-level-input').value  = p.level || 'C';
  document.getElementById('player-captain-input').checked = p.is_captain;
  document.getElementById('player-guest-input').checked   = p.is_guest;
  document.getElementById('btn-delete-player').style.display = 'inline-flex';
  _updatePlayerTeamOpts(p.team_id);
  showModal('modal-player');
}

function _updatePlayerTeamOpts(selectedTeamId) {
  const sel = document.getElementById('player-team-input');
  sel.innerHTML = '<option value="">미배정</option>';
  state.teams.forEach(team => {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.textContent = (team.position ? team.position + '. ' : '') + team.name;
    if (team.id === selectedTeamId) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function savePlayer() {
  const name      = document.getElementById('player-name-input').value.trim();
  const gender    = document.getElementById('player-gender-input').value;
  const level     = document.getElementById('player-level-input').value;
  const teamId    = document.getElementById('player-team-input').value || null;
  const isCaptain = document.getElementById('player-captain-input').checked;
  const isGuest   = document.getElementById('player-guest-input').checked;

  if (!name) { showToast('선수명을 입력하세요', 'error'); return; }

  const data = { name, gender, level, team_id: teamId, is_captain: isCaptain, is_guest: isGuest };

  if (state.editingPlayerId) {
    const { error } = await sb.from('players').update(data).eq('id', state.editingPlayerId);
    if (error) { showToast('저장 실패: ' + error.message, 'error'); return; }
  } else {
    const { error } = await sb.from('players').insert({ ...data, is_active: true });
    if (error) { showToast('저장 실패: ' + error.message, 'error'); return; }
  }

  closeAllModals();
  await loadAll();
  renderView(state.currentView);
  showToast('선수 저장 완료');
}

function deleteCurrentPlayer() {
  if (!state.editingPlayerId) return;
  const p = getPlayerById(state.editingPlayerId);
  openConfirm(`"${p.name}" 선수를 삭제할까요?`, async () => {
    const { error } = await sb.from('players').delete().eq('id', state.editingPlayerId);
    if (error) { showToast('삭제 실패', 'error'); return; }
    await loadAll();
    renderView(state.currentView);
    showToast('선수 삭제 완료');
  });
}

/** 더블클릭: 조장 토글 */
async function toggleCaptain(event, playerId) {
  event.preventDefault();
  event.stopPropagation();

  const p       = getPlayerById(playerId);
  const team    = getTeamById(p.team_id);
  const becomeCaptain = !p.is_captain;

  // 1. 기존 조장 해제 (같은 팀 내 다른 조장)
  if (becomeCaptain) {
    const prevCaptain = state.players.find(x => x.team_id === p.team_id && x.is_captain && x.id !== playerId);
    if (prevCaptain) {
      await sb.from('players').update({ is_captain: false }).eq('id', prevCaptain.id);
    }
  }

  // 2. 해당 선수 조장 상태 변경
  const { error } = await sb.from('players').update({ is_captain: becomeCaptain }).eq('id', playerId);
  if (error) { showToast('변경 실패', 'error'); return; }

  // 3. 팀명 업데이트
  if (team) {
    const newTeamName = becomeCaptain
      ? p.name                                          // 조장 지정 → 팀명 = 조장 이름
      : (team.position ? `${team.position}팀` : team.name); // 조장 해제 → N팀으로 복원
    await sb.from('teams').update({ name: newTeamName }).eq('id', team.id);
  }

  await loadAll();
  renderTeams();
  showToast(becomeCaptain ? `${p.name} 조장 지정 · 팀명 업데이트` : `${p.name} 조장 해제`);
}

/** × 버튼: 팀원 제외 → 미배정 전환 */
async function removeFromTeam(event, playerId) {
  event.stopPropagation();
  event.preventDefault();
  const p = getPlayerById(playerId);
  // 조장이었다면 팀명 복원
  if (p.is_captain) {
    const team = getTeamById(p.team_id);
    if (team?.position) await sb.from('teams').update({ name: `${team.position}팀` }).eq('id', team.id);
  }
  const { error } = await sb.from('players')
    .update({ team_id: null, is_captain: false })
    .eq('id', playerId);
  if (error) { showToast('변경 실패', 'error'); return; }
  await loadAll();
  renderTeams();
  showToast(`${p.name} 미배정으로 이동`);
}

/** 드래그: 미배정 영역으로 드롭 */
async function onDropToUnassigned(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if (!_dragPlayerId) return;
  const p = getPlayerById(_dragPlayerId);
  if (!p?.team_id) { _dragPlayerId = null; return; } // 이미 미배정
  // 조장이었다면 팀명 복원
  if (p.is_captain) {
    const team = getTeamById(p.team_id);
    if (team?.position) await sb.from('teams').update({ name: `${team.position}팀` }).eq('id', team.id);
  }
  const { error } = await sb.from('players')
    .update({ team_id: null, is_captain: false })
    .eq('id', _dragPlayerId);
  _dragPlayerId = null;
  if (error) { showToast('배정 해제 실패', 'error'); return; }
  await loadAll();
  renderTeams();
  showToast('미배정으로 이동');
}

/* ─────────────────────────────────────────────────────
   대진표 생성 / 초기화
   ───────────────────────────────────────────────────── */
async function generateBracket() {
  // 6팀 포지션 완전 배정 확인
  const positioned = state.teams.filter(t => t.position);
  const positions  = positioned.map(t => t.position);
  if (positions.length < 6 || new Set(positions).size < 6) {
    showToast('6개 팀 모두 포지션(1~6)이 배정되어야 합니다', 'error');
    return;
  }

  // 기존 대진표 삭제 (game_assignments는 cascade)
  if (state.matches.length > 0) {
    const { error: delErr } = await sb.from('matches').delete().gte('set_number', 1);
    if (delErr) { showToast('초기화 실패: ' + delErr.message, 'error'); return; }
  }

  // 포지션 랜덤 매핑: 1~6을 무작위 순열로 섞어 팀 대진 랜덤화
  const _shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const perm = _shuffle([1, 2, 3, 4, 5, 6]);
  const posMap = {};
  [1, 2, 3, 4, 5, 6].forEach((p, i) => posMap[p] = perm[i]);

  // 15경기 일괄 생성 (각 세트 내 코트 순서도 셔플)
  const courts = ['A', 'B', 'C'];
  const rows = [];
  BRACKET_STRUCTURE.forEach(s => {
    const shuffled = _shuffle([...s.matches]);
    shuffled.forEach((m, idx) =>
      rows.push({
        set_number: s.set,
        court: courts[idx],
        position_a: posMap[m.posA],
        position_b: posMap[m.posB],
        status: 'pending'
      })
    );
  });

  const { error } = await sb.from('matches').insert(rows);
  if (error) { showToast('대진표 생성 실패: ' + error.message, 'error'); return; }

  await loadAll();
  state.currentSet = 1;
  renderView(state.currentView);
  showToast('대진표 생성 완료 (15경기)');
}

function openResetBracket() {
  openConfirm(
    '대진표와 모든 경기 데이터를 초기화할까요?\n되돌릴 수 없습니다.',
    async () => {
      const { error } = await sb.from('matches').delete().gte('set_number', 1);
      if (error) { showToast('초기화 실패', 'error'); return; }
      await loadAll();
      state.currentSet = 1;
      renderView(state.currentView);
      showToast('대진표 초기화 완료');
    }
  );
}

/* ─────────────────────────────────────────────────────
   자동 배정 알고리즘
   ───────────────────────────────────────────────────── */

/** n개 배열에서 k개 조합 생성 */
function getCombinations(arr, k) {
  const result = [];
  function pick(start, cur) {
    if (cur.length === k) { result.push([...cur]); return; }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      pick(i + 1, cur);
      cur.pop();
    }
  }
  pick(0, []);
  return result;
}

async function autoAssignSet(setNumber) {
  const setMatches = state.matches.filter(m => m.set_number === setNumber);
  if (!setMatches.length) {
    showToast('대진표가 없습니다. 먼저 대진표를 생성하세요', 'error');
    return;
  }

  // 해당 세트에 결과가 저장된 경기가 하나라도 있으면 자동배정 불가
  const hasResult = setMatches.some(m => m.status === 'completed');
  if (hasResult) {
    showToast(`SET ${setNumber}에 저장된 경기 결과가 있어 자동배정을 실행할 수 없습니다`, 'error');
    return;
  }

  // ── 게임 횟수 집계 (이 세트 이전까지) ──
  const gameCountMap = {};
  state.assignments.forEach(asgn => {
    const match = state.matches.find(m => m.id === asgn.match_id);
    if (match && match.set_number < setNumber) {
      [asgn.player1_id, asgn.player2_id].forEach(pid => {
        gameCountMap[pid] = (gameCountMap[pid] || 0) + 1;
      });
    }
  });

  // ── 파트너 이력 ──
  const partnerMap = {};
  state.assignments.forEach(asgn => {
    const key = [asgn.player1_id, asgn.player2_id].sort().join(':');
    partnerMap[key] = (partnerMap[key] || 0) + 1;
  });

  // ── 직전 세트 배정 (팀별) ──
  const prevMap = {}; // teamId -> [p1id, p2id]
  state.matches
    .filter(m => m.set_number === setNumber - 1)
    .forEach(m => {
      state.assignments
        .filter(a => a.match_id === m.id)
        .forEach(a => { prevMap[a.team_id] = [a.player1_id, a.player2_id]; });
    });

  // ── 각 경기 팀별 최적 조합 선택 ──
  const toInsert = [];
  for (const match of setMatches) {
    const teamA = getTeamByPosition(match.position_a);
    const teamB = getTeamByPosition(match.position_b);

    if (!teamA || !teamB) {
      showToast(`포지션 ${match.position_a} 또는 ${match.position_b} 팀을 찾을 수 없습니다`, 'error');
      return;
    }

    const playersA = getTeamPlayers(teamA.id);
    const playersB = getTeamPlayers(teamB.id);

    if (playersA.length < 2) {
      showToast(`"${teamA.name}" 팀 활성 선수가 2명 미만입니다`, 'error'); return;
    }
    if (playersB.length < 2) {
      showToast(`"${teamB.name}" 팀 활성 선수가 2명 미만입니다`, 'error'); return;
    }

    const pairA = _bestPair(playersA, teamA.id, setNumber, gameCountMap, partnerMap, prevMap);
    const pairB = _bestPair(playersB, teamB.id, setNumber, gameCountMap, partnerMap, prevMap);

    toInsert.push({ match_id: match.id, team_id: teamA.id, player1_id: pairA[0].id, player2_id: pairA[1].id });
    toInsert.push({ match_id: match.id, team_id: teamB.id, player1_id: pairB[0].id, player2_id: pairB[1].id });
  }

  // 해당 세트 기존 배정 삭제 후 신규 삽입
  const matchIds = setMatches.map(m => m.id);
  await sb.from('game_assignments').delete().in('match_id', matchIds);

  const { error } = await sb.from('game_assignments').insert(toInsert);
  if (error) { showToast('배정 저장 실패: ' + error.message, 'error'); return; }

  await loadAll();
  renderMatch();
  showToast(`SET ${setNumber} 자동 배정 완료`);
}

async function autoAssignAllSets() {
  if (!state.matches.length) {
    showToast('대진표가 없습니다. 먼저 대진표를 생성하세요', 'error');
    return;
  }

  // 어느 세트든 결과가 저장된 경기가 하나라도 있으면 올세트 자동배정 불가
  const hasAnyResult = state.matches.some(m => m.status === 'completed');
  if (hasAnyResult) {
    showToast('저장된 경기 결과가 있어 올세트 자동배정을 실행할 수 없습니다', 'error');
    return;
  }

  showToast('올세트 자동배정 중...');
  for (let s = 1; s <= 5; s++) {
    await autoAssignSet(s);
  }
  showToast('전체 세트 자동 배정 완료 (SET 1~5)');
}

/**
 * 팀 선수 목록에서 최적 2인 조합 선택
 * 점수 기준:
 *   +20×2  경기수 최소인 선수 포함
 *   -5×합  누적 게임수 패널티 (균등화)
 *   +8     직전 세트 미출전 (각 선수)
 *   +5     파트너 첫 조합
 *   -3×n   파트너 반복 횟수 패널티
 *   -1000  직전 세트 동일 2명(3명+ 팀) → 사실상 금지
 */
function _bestPair(players, teamId, setNum, gameCountMap, partnerMap, prevMap) {
  const combos    = getCombinations(players, 2);
  const prevPair  = prevMap[teamId] || [];

  const scored = combos.map(([p1, p2]) => {
    let score = 0;

    const gc1    = gameCountMap[p1.id] || 0;
    const gc2    = gameCountMap[p2.id] || 0;
    const minGC  = Math.min(...players.map(p => gameCountMap[p.id] || 0));

    // 게임수 균등 (낮을수록 우선)
    if (gc1 === minGC) score += 20;
    if (gc2 === minGC) score += 20;
    score -= (gc1 + gc2) * 5;

    // 직전 세트 미출전 보너스
    if (setNum > 1) {
      if (!prevPair.includes(p1.id)) score += 8;
      if (!prevPair.includes(p2.id)) score += 8;
    }

    // 파트너 이력
    const pairKey   = [p1.id, p2.id].sort().join(':');
    const pairCount = partnerMap[pairKey] || 0;
    if (pairCount === 0) score += 5;
    score -= pairCount * 3;

    // 직전 세트 동일 2명 금지 (팀 3명 이상)
    if (players.length >= 3 && prevPair.length === 2) {
      if (new Set(prevPair).has(p1.id) && new Set(prevPair).has(p2.id)) {
        score -= 1000;
      }
    }

    return { pair: [p1, p2], score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].pair;
}

/* ─────────────────────────────────────────────────────
   선수 수동 변경 (경기 뷰)
   ───────────────────────────────────────────────────── */
function openPlayerSelect(matchId, teamId, slot) {
  const team    = getTeamById(teamId);
  const players = getTeamPlayers(teamId);
  const asgn    = getMatchAssignment(matchId, teamId);

  const currentId = asgn
    ? (slot === 1 ? asgn.player1_id : asgn.player2_id)
    : null;

  state.selectCtx = { matchId, teamId, slot };

  document.getElementById('modal-select-title').textContent =
    `${team?.name || ''} · ${slot}번 선수 변경`;

  const list = document.getElementById('player-select-list');
  list.innerHTML = players.length
    ? players.map(p => `
        <div class="player-select-option ${p.id === currentId ? 'current-player' : ''}"
             onclick="selectPlayer('${p.id}')">
          <span class="gender-badge ${p.gender === 'male' ? 'male' : 'female'}" style="font-size:10px">
            ${p.gender === 'male' ? 'M' : 'F'}
          </span>
          ${p.is_captain ? '<span class="captain-star" title="조장">★</span>' : ''}
          <span>${p.name}</span>
          ${p.level ? `<span class="level-badge">${p.level}</span>` : ''}
          ${p.is_guest ? '<span class="guest-badge">G</span>' : ''}
          <span class="games-count" style="margin-left:auto">${getPlayerGameCount(p.id)}경기</span>
          ${p.id === currentId ? '<span style="margin-left:4px; font-size:10px; color:var(--accent)">현재</span>' : ''}
        </div>
      `).join('')
    : '<div style="padding:16px; color:var(--text-muted); font-size:13px;">이 팀에 활성 선수가 없습니다.</div>';

  showModal('modal-select-player');
}

async function selectPlayer(playerId) {
  const { matchId, teamId, slot } = state.selectCtx;
  const asgn = getMatchAssignment(matchId, teamId);

  if (!asgn) {
    showToast('먼저 자동 배정을 실행하세요', 'error');
    closeAllModals();
    return;
  }

  const update = slot === 1 ? { player1_id: playerId } : { player2_id: playerId };
  const { error } = await sb.from('game_assignments').update(update).eq('id', asgn.id);
  if (error) { showToast('변경 실패', 'error'); return; }

  closeAllModals();
  await loadAll();
  renderMatch();
  showToast('선수 변경 완료');
}

/* ─────────────────────────────────────────────────────
   경기 결과 저장
   ───────────────────────────────────────────────────── */
async function saveScore(matchId) {
  const aEl = document.getElementById('score-a-' + matchId);
  const bEl = document.getElementById('score-b-' + matchId);
  const sa  = parseInt(aEl.value);
  const sb_ = parseInt(bEl.value);

  if (isNaN(sa) || isNaN(sb_)) { showToast('점수를 입력하세요', 'error'); return; }
  if (sa < 0 || sb_ < 0)       { showToast('점수는 0 이상이어야 합니다', 'error'); return; }
  if (sa === sb_)               { showToast('동점은 허용되지 않습니다', 'error'); return; }

  const { error } = await sb.from('matches')
    .update({ score_a: sa, score_b: sb_, status: 'completed' })
    .eq('id', matchId);
  if (error) { showToast('저장 실패: ' + error.message, 'error'); return; }

  // state만 업데이트, 해당 코트 카드만 교체
  const idx = state.matches.findIndex(m => m.id === matchId);
  if (idx !== -1) {
    state.matches[idx] = { ...state.matches[idx], score_a: sa, score_b: sb_, status: 'completed' };
  }
  _refreshCourtCard(matchId);
  _refreshMatchRanking();
  updateHeaderStatus();
  showToast('결과 저장 완료');
}

async function editScore(matchId) {
  const { error } = await sb.from('matches')
    .update({ score_a: null, score_b: null, status: 'pending' })
    .eq('id', matchId);
  if (error) { showToast('수정 전환 실패', 'error'); return; }

  const idx = state.matches.findIndex(m => m.id === matchId);
  if (idx !== -1) {
    state.matches[idx] = { ...state.matches[idx], score_a: null, score_b: null, status: 'pending' };
  }
  _refreshCourtCard(matchId);
  _refreshMatchRanking();
}

function _refreshMatchRanking() {
  const el = document.getElementById('match-ranking-section');
  if (!el) return;
  el.innerHTML = `
    <div class="ranking-section-divider">
      <span>🏆 현재 순위</span>
    </div>
    ${_rankingHtml()}
  `;
}

function _refreshCourtCard(matchId) {
  const cardEl = document.getElementById('court-card-' + matchId);
  if (!cardEl) return;
  const match  = state.matches.find(m => m.id === matchId);
  if (!match)  return;
  const teamA  = getTeamByPosition(match.position_a);
  const teamB  = getTeamByPosition(match.position_b);
  const asgnA  = teamA ? getMatchAssignment(match.id, teamA.id) : null;
  const asgnB  = teamB ? getMatchAssignment(match.id, teamB.id) : null;
  const done   = match.status === 'completed';

  const tmp = document.createElement('div');
  tmp.innerHTML = `
    <div class="court-card court-${match.court.toLowerCase()} ${done ? 'court-card-done' : ''}" id="court-card-${match.id}">
      <div class="court-header">
        🏸 COURT ${match.court} &nbsp;·&nbsp;
        ${teamA?.name || match.position_a+'팀'} vs ${teamB?.name || match.position_b+'팀'}
      </div>
      <div class="court-body">
        <div class="match-teams">
          ${_teamSide(match, teamA, asgnA)}
          <div class="vs-badge">VS</div>
          ${_teamSide(match, teamB, asgnB)}
        </div>
        <div class="score-row">
          <input class="score-input ${done ? (match.score_a > match.score_b ? 'score-win' : 'score-lose') : ''}"
                 id="score-a-${match.id}" type="number" min="0"
                 value="${done ? match.score_a : ''}" placeholder="–"
                 ${done ? 'readonly' : ''}
                 onkeydown="if(event.key==='Enter') saveScore('${match.id}')">
          <div class="score-dash">:</div>
          <input class="score-input ${done ? (match.score_b > match.score_a ? 'score-win' : 'score-lose') : ''}"
                 id="score-b-${match.id}" type="number" min="0"
                 value="${done ? match.score_b : ''}" placeholder="–"
                 ${done ? 'readonly' : ''}
                 onkeydown="if(event.key==='Enter') saveScore('${match.id}')">
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:8px; gap:6px">
          ${done
            ? `<button class="btn-xs" onclick="editScore('${match.id}')">✏️ 수정</button>
               <button class="btn-saved">✓ 저장됨</button>`
            : `<button class="btn-primary" style="font-size:11px; padding:5px 12px" onclick="saveScore('${match.id}')">결과 저장</button>`
          }
        </div>
      </div>
    </div>
  `;
  cardEl.replaceWith(tmp.firstElementChild);
}

/* ─────────────────────────────────────────────────────
   순위 계산
   ───────────────────────────────────────────────────── */
function calcRankings() {
  // 팀별 초기 스탯
  const stats = {};
  state.teams.forEach(t => {
    stats[t.id] = { team: t, wins: 0, losses: 0, scoreFor: 0, scoreAgainst: 0, femaleCount: 0 };
  });

  state.matches.forEach(match => {
    if (match.status !== 'completed') return;

    const ta = getTeamByPosition(match.position_a);
    const tb = getTeamByPosition(match.position_b);
    if (!ta || !tb || !stats[ta.id] || !stats[tb.id]) return;

    const sa = stats[ta.id];
    const sb_ = stats[tb.id];

    sa.scoreFor     += match.score_a;
    sa.scoreAgainst += match.score_b;
    sb_.scoreFor    += match.score_b;
    sb_.scoreAgainst += match.score_a;

    if (match.score_a > match.score_b) { sa.wins++; sb_.losses++; }
    else                               { sb_.wins++; sa.losses++;  }

    // 여성 선수 출전 수 집계
    const asgnA = getMatchAssignment(match.id, ta.id);
    const asgnB = getMatchAssignment(match.id, tb.id);
    if (asgnA) {
      if (getPlayerById(asgnA.player1_id)?.gender === 'female') sa.femaleCount++;
      if (getPlayerById(asgnA.player2_id)?.gender === 'female') sa.femaleCount++;
    }
    if (asgnB) {
      if (getPlayerById(asgnB.player1_id)?.gender === 'female') sb_.femaleCount++;
      if (getPlayerById(asgnB.player2_id)?.gender === 'female') sb_.femaleCount++;
    }
  });

  return Object.values(stats).sort((a, b) => {
    if (b.wins         !== a.wins)         return b.wins - a.wins;
    if (b.scoreFor     !== a.scoreFor)     return b.scoreFor - a.scoreFor;
    if (a.scoreAgainst !== b.scoreAgainst) return a.scoreAgainst - b.scoreAgainst;
    return b.femaleCount - a.femaleCount;
  });
}

/* ─────────────────────────────────────────────────────
   랜덤 팀 배정
   ───────────────────────────────────────────────────── */
async function randomAssignPlayers() {
  const teams = state.teams;
  if (!teams.length) { showToast('팀이 없습니다', 'error'); return; }

  const unassigned = getUnassigned();
  if (!unassigned.length) { showToast('미배정 선수가 없습니다', 'error'); return; }

  // 남성 점수 높은 순 → 여성 점수 높은 순으로 정렬
  const men   = unassigned.filter(p => p.gender === 'male')
                           .sort((a, b) => getPlayerScore(b) - getPlayerScore(a));
  const women = unassigned.filter(p => p.gender === 'female')
                           .sort((a, b) => getPlayerScore(b) - getPlayerScore(a));
  const combined = [...men, ...women];

  // 점수 기반 그리디 배정: 각 선수를 현재 총점이 가장 낮은 팀에 배정
  const teamScores = {};
  const assignMap  = {};
  teams.forEach(t => { teamScores[t.id] = 0; assignMap[t.id] = []; });

  combined.forEach(p => {
    const targetId = Object.entries(teamScores)
      .sort((a, b) => a[1] - b[1])[0][0];
    assignMap[targetId].push(p.id);
    teamScores[targetId] += getPlayerScore(p);
  });

  const total = unassigned.length;
  const preview = teams.map(t => `${t.name}: ${teamScores[t.id].toFixed(1)}점`).join(' / ');
  openConfirm(
    `미배정 선수 ${total}명을 ${teams.length}팀에 점수 균등 배정하시겠습니까?\n\n예상 팀 총점:\n${preview}`,
    async () => {
      const updates = [];
      for (const [teamId, pids] of Object.entries(assignMap)) {
        for (const pid of pids) {
          updates.push(sb.from('players').update({ team_id: teamId }).eq('id', pid));
        }
      }
      await Promise.all(updates);
      await loadAll();
      renderTeams();
      showToast(`${total}명 랜덤 배정 완료`);
    }
  );
}

/* ─────────────────────────────────────────────────────
   렌더 · 팀/선수 관리
   ───────────────────────────────────────────────────── */
function renderTeams() {
  const el         = document.getElementById('view-teams');
  const unassigned = getUnassigned();
  const teamColors = ['var(--accent)', 'var(--accent2)', 'var(--accent3)', '#a855f7', '#f59e0b', '#ec4899'];

  el.innerHTML = `
    <div class="control-bar">
      <span style="font-weight:700; font-size:15px;">팀 · 선수 관리</span>
      <span style="font-size:12px; color:var(--text-muted)">${state.teams.length}팀 · ${state.players.filter(p => p.is_active).length}명</span>
      <div class="spacer"></div>
      <button class="btn-outline" style="margin-right:6px" onclick="openImportModal()">📋 마스터 명단</button>
      <button class="btn-outline btn-danger-outline" style="margin-right:6px" onclick="deleteAllGuests()">게스트 전체 삭제</button>
      <button class="btn-outline btn-danger-outline" style="margin-right:6px" onclick="resetTeamSettings()">팀 세팅 초기화</button>
      <button class="btn-outline" style="margin-right:6px" onclick="openAddTeam()">+ 팀 추가</button>
      <button class="btn-outline" style="margin-right:6px" onclick="randomAssignPlayers()">🎲 랜덤배정</button>
      <button class="btn-primary" onclick="openAddPlayer()">+ 선수 등록</button>
    </div>

    <div class="team-grid">
      ${state.teams.map((team, i) => _teamCard(team, teamColors[i % 6])).join('')}
      ${state.teams.length < 6 ? `
        <div class="add-team-placeholder" onclick="openAddTeam()">
          <span style="font-size:24px">+</span> 팀 추가
        </div>
      ` : ''}
    </div>

    <div class="unassigned-section"
         ondragover="event.preventDefault(); this.classList.add('drag-over')"
         ondragleave="this.classList.remove('drag-over')"
         ondrop="onDropToUnassigned(event)">
      <div class="unassigned-title">미배정 선수 (${unassigned.length}명)${unassigned.length ? ' — 클릭하여 수정' : ' — 여기로 드래그해서 팀 제외'}</div>
      ${unassigned.length ? `
      <div class="player-chips">
        ${unassigned.map(p => `
          <div class="player-chip"
               draggable="true"
               ondragstart="onDragStart(event, '${p.id}')"
               ondragend="onDragEnd(event)"
               onclick="openEditPlayer('${p.id}')"
               title="팀 카드로 드래그해서 배정">
            <span class="gender-badge ${p.gender === 'male' ? 'male' : 'female'}" style="font-size:10px">
              ${p.gender === 'male' ? 'M' : 'F'}
            </span>
            ${p.name}
            ${p.level ? `<span class="level-badge">${p.level}</span>` : ''}
            ${p.is_guest ? '<span class="guest-badge">G</span>' : ''}
          </div>
        `).join('')}
      </div>
      ` : ''}
    </div>
  `;
}

function _teamCard(team, color) {
  const _lo = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  const players = getTeamPlayers(team.id).sort((a, b) => {
    const gDiff = (a.gender === 'male' ? 0 : 1) - (b.gender === 'male' ? 0 : 1);
    if (gDiff !== 0) return gDiff;
    return (_lo[a.level] ?? 9) - (_lo[b.level] ?? 9);
  });
  return `
    <div class="team-card" style="border-top: 3px solid ${color}"
         ondragover="onDragOver(event, this)"
         ondragleave="onDragLeave(event)"
         ondrop="onDrop(event, '${team.id}')"
         ondragend="onDragEnd(event)">
      <div style="display:flex; align-items:flex-start; gap:8px; margin-bottom:8px">
        <div class="team-num">${team.position ? String(team.position).padStart(2,'0') : '??'}</div>
        <div style="flex:1">
          <div class="team-name">${team.name}</div>
          <div style="font-size:10px; color:var(--text-muted)">포지션 ${team.position || '미배정'} · ${players.length}명</div>
        </div>
        <div class="team-score-badge" title="팀 총점">
          ${getTeamScore(team.id).toFixed(1)}<span style="font-size:9px;margin-left:1px">pt</span>
        </div>
      </div>
      <div class="player-list">
        ${players.length
          ? players.map(p => `
              <div class="player-item"
                   draggable="true"
                   ondragstart="onDragStart(event, '${p.id}')"
                   ondragend="onDragEnd(event)"
                   ondblclick="toggleCaptain(event, '${p.id}')"
                   title="더블클릭: 조장 토글 | × 버튼: 팀 제외 | 드래그: 이동">
                <span class="gender-badge ${p.gender === 'male' ? 'male' : 'female'}">${p.gender === 'male' ? 'M' : 'F'}</span>
                ${p.is_captain ? '<span class="captain-star" title="조장">★</span>' : ''}
                <span>${p.name}</span>
                ${p.level ? `<span class="level-badge">${p.level}</span>` : ''}
                ${p.is_guest ? '<span class="guest-badge">G</span>' : ''}
                <span class="games-count">${getPlayerGameCount(p.id)}경기</span>
                <button class="btn-remove-member" onclick="removeFromTeam(event, '${p.id}')" title="팀에서 제외">×</button>
              </div>
            `).join('')
          : '<div style="font-size:12px; color:var(--text-muted); padding:4px">선수 없음 · 드래그로 배정</div>'
        }
      </div>
      <div class="team-actions">
        <button class="btn-xs" onclick="openEditTeam('${team.id}')">✏️ 팀수정</button>
        <button class="btn-xs" onclick="openAddPlayer('${team.id}')">+ 선수</button>
        <button class="btn-xs" style="color:var(--lose)" onclick="openDeleteTeam('${team.id}')">🗑</button>
      </div>
    </div>
  `;
}

/* ─────────────────────────────────────────────────────
   렌더 · 경기 현황
   ───────────────────────────────────────────────────── */
function renderMatch() {
  const el         = document.getElementById('view-match');
  const hasMatches = state.matches.length > 0;

  const rankingSection = state.matches.length ? `
    <div id="match-ranking-section">
      <div class="ranking-section-divider">
        <span>🏆 현재 순위</span>
      </div>
      ${_rankingHtml()}
    </div>
  ` : '';

  el.innerHTML = _flowBar() + (hasMatches ? _matchContent() : `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <p>대진표가 없습니다.</p>
      <p style="margin-top:4px">6팀 포지션 배정 후 대진표를 생성하세요.</p>
      <button class="btn-primary" style="margin-top:16px" onclick="navigate('bracket')">대진표 화면으로 이동</button>
    </div>
  `) + rankingSection;
}

function _matchContent() {
  const currentSetHasResult = state.matches
    .filter(m => m.set_number === state.currentSet)
    .some(m => m.status === 'completed');
  const anySetHasResult = state.matches.some(m => m.status === 'completed');
  const singleDisabled = currentSetHasResult ? 'class="btn-assign btn-assign-disabled"' : 'class="btn-assign"';
  const allDisabled    = anySetHasResult     ? 'class="btn-assign btn-assign-all btn-assign-disabled"' : 'class="btn-assign btn-assign-all"';

  return `
    <div class="assign-bar">
      <div class="assign-icon">⚡</div>
      <div class="assign-text">
        <div class="assign-title">SET ${state.currentSet} 선수 자동 배정</div>
        <div class="assign-sub">균등 출전 · 파트너 중복 최소화 · 연속 출전 제한 알고리즘 적용</div>
      </div>
      <div class="win-score-box">
        <span class="win-score-label">승리점수</span>
        <input class="win-score-input" id="win-score-input" type="number" min="1" max="99"
               value="${state.winScore}"
               onchange="setWinScore(this.value)"
               title="승리 기준 점수 설정">
        <span class="win-score-unit">점</span>
      </div>
      <button ${singleDisabled} onclick="autoAssignSet(${state.currentSet})">▶ 단세트 자동배정</button>
      <button ${allDisabled} onclick="autoAssignAllSets()">⚡ 올세트 자동배정</button>
    </div>

    <div class="bracket-nav">
      ${[1,2,3,4,5].map(s => {
        const status = getSetStatus(s);
        return `<div class="set-tab ${status === 'completed' ? 'done' : ''} ${s === state.currentSet ? 'active' : ''}"
                     onclick="switchSet(${s})">
          ${status === 'completed' ? `SET ${s} ✓` : `SET ${s}`}
        </div>`;
      }).join('')}
    </div>

    <div class="court-grid">
      ${_setCourts(state.currentSet)}
    </div>
  `;
}

function _setCourts(setNum) {
  const setMatches = state.matches
    .filter(m => m.set_number === setNum)
    .sort((a, b) => a.court < b.court ? -1 : 1);

  return setMatches.map(match => {
    const teamA = getTeamByPosition(match.position_a);
    const teamB = getTeamByPosition(match.position_b);
    const asgnA = teamA ? getMatchAssignment(match.id, teamA.id) : null;
    const asgnB = teamB ? getMatchAssignment(match.id, teamB.id) : null;
    const done  = match.status === 'completed';

    return `
      <div class="court-card court-${match.court.toLowerCase()} ${done ? 'court-card-done' : ''}" id="court-card-${match.id}">
        <div class="court-header">
          🏸 COURT ${match.court} &nbsp;·&nbsp;
          ${teamA?.name || match.position_a+'팀'} vs ${teamB?.name || match.position_b+'팀'}
        </div>
        <div class="court-body">
          <div class="match-teams">
            ${_teamSide(match, teamA, asgnA)}
            <div class="vs-badge">VS</div>
            ${_teamSide(match, teamB, asgnB)}
          </div>
          <div class="score-row">
            <input class="score-input ${done ? (match.score_a > match.score_b ? 'score-win' : 'score-lose') : ''}"
                   id="score-a-${match.id}" type="number" min="0"
                   value="${done ? match.score_a : ''}" placeholder="–"
                   ${done ? 'readonly' : ''}
                   onkeydown="if(event.key==='Enter') saveScore('${match.id}')">
            <div class="score-dash">:</div>
            <input class="score-input ${done ? (match.score_b > match.score_a ? 'score-win' : 'score-lose') : ''}"
                   id="score-b-${match.id}" type="number" min="0"
                   value="${done ? match.score_b : ''}" placeholder="–"
                   ${done ? 'readonly' : ''}
                   onkeydown="if(event.key==='Enter') saveScore('${match.id}')">
          </div>
          <div style="display:flex; justify-content:flex-end; margin-top:8px; gap:6px">
            ${done
              ? `<button class="btn-xs" onclick="editScore('${match.id}')">✏️ 수정</button>
                 <button class="btn-saved">✓ 저장됨</button>`
              : `<button class="btn-primary" style="font-size:11px; padding:5px 12px" onclick="saveScore('${match.id}')">결과 저장</button>`
            }
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function _teamSide(match, team, asgn) {
  if (!team) {
    return `<div class="match-team"><div class="match-team-name" style="color:var(--text-muted)">팀 미배정</div></div>`;
  }

  const p1 = asgn ? getPlayerById(asgn.player1_id) : null;
  const p2 = asgn ? getPlayerById(asgn.player2_id) : null;

  const isA = match.position_a === team.position;
  const otherDone = match.status === 'completed';

  const gcMap = {};
  state.assignments.forEach(a => {
    gcMap[a.player1_id] = (gcMap[a.player1_id] || 0) + 1;
    gcMap[a.player2_id] = (gcMap[a.player2_id] || 0) + 1;
  });

  const gcBadge = pid => {
    const n = gcMap[pid] || 0;
    return `<span class="game-count-badge">${n}G</span>`;
  };

  return `
    <div class="match-team">
      <div class="match-team-header">
        <div class="match-team-name">
          ${team.name}
          <span style="font-size:10px; color:var(--text-muted)">#${team.position}</span>
        </div>
        ${!otherDone ? `<button class="btn-win" onclick="fillWinScore('${match.id}', '${isA ? 'a' : 'b'}')" title="승리점수 자동 입력">승</button>` : ''}
      </div>
      <div class="match-players">
        ${p1
          ? `<div class="match-player" onclick="openPlayerSelect('${match.id}','${team.id}',1)" title="클릭하여 변경">
               <span class="gender-badge ${p1.gender==='male'?'male':'female'}" style="font-size:9px">${p1.gender==='male'?'M':'F'}</span>
               ${p1.name}
               ${p1.level ? `<span style="font-size:9px;color:var(--text-muted)">${p1.level}</span>` : ''}
               ${gcBadge(p1.id)}
             </div>`
          : '<div class="match-player-empty">미배정</div>'
        }
        ${p2
          ? `<div class="match-player" onclick="openPlayerSelect('${match.id}','${team.id}',2)" title="클릭하여 변경">
               <span class="gender-badge ${p2.gender==='male'?'male':'female'}" style="font-size:9px">${p2.gender==='male'?'M':'F'}</span>
               ${p2.name}
               ${p2.level ? `<span style="font-size:9px;color:var(--text-muted)">${p2.level}</span>` : ''}
               ${gcBadge(p2.id)}
             </div>`
          : '<div class="match-player-empty">미배정</div>'
        }
      </div>
    </div>
  `;
}

function _flowBar() {
  const has6Teams  = state.teams.filter(t => t.position).length === 6;
  const hasMatches = state.matches.length > 0;
  const allDone    = state.matches.length === 15 && state.matches.every(m => m.status === 'completed');

  return `
    <div class="flow">
      <div class="flow-step ${has6Teams  ? 'done' : 'current'}"><span class="flow-icon">${has6Teams  ? '✅' : '⏳'}</span> 팀·선수 등록</div>
      <div class="flow-arrow">→</div>
      <div class="flow-step ${hasMatches ? 'done' : has6Teams ? 'current' : ''}"><span class="flow-icon">${hasMatches ? '✅' : '📋'}</span> 대진표 생성</div>
      <div class="flow-arrow">→</div>
      <div class="flow-step ${hasMatches && !allDone ? 'current' : ''}"><span class="flow-icon">⚡</span> 선수 자동 배정</div>
      <div class="flow-arrow">→</div>
      <div class="flow-step ${hasMatches && !allDone ? 'current' : ''}"><span class="flow-icon">📝</span> 결과 입력</div>
      <div class="flow-arrow">→</div>
      <div class="flow-step ${allDone ? 'done' : ''}"><span class="flow-icon">🏆</span> 순위 확인</div>
    </div>
  `;
}

function switchSet(s) {
  state.currentSet = s;
  renderMatch();
}

function setWinScore(val) {
  const v = parseInt(val, 10);
  if (!v || v < 1) return;
  state.winScore = v;
}

function fillWinScore(matchId, side) {
  const aEl = document.getElementById('score-a-' + matchId);
  const bEl = document.getElementById('score-b-' + matchId);
  if (!aEl || !bEl) return;
  if (side === 'a') {
    aEl.value = state.winScore;
    if (!bEl.value) bEl.focus(); else aEl.focus();
  } else {
    bEl.value = state.winScore;
    if (!aEl.value) aEl.focus(); else bEl.focus();
  }
  showToast(`승리점수 ${state.winScore}점 입력됨 · 결과 저장 버튼을 눌러 확정하세요`);
}

/* ─────────────────────────────────────────────────────
   렌더 · 대진표
   ───────────────────────────────────────────────────── */
function renderBracket() {
  const el          = document.getElementById('view-bracket');
  const hasMatches  = state.matches.length > 0;
  const allPosd     = state.teams.filter(t => t.position).length === 6;

  el.innerHTML = `
    <div class="control-bar">
      <span style="font-weight:700; font-size:15px;">대진표</span>
      <div class="spacer"></div>
      ${hasMatches
        ? `<button class="btn-outline" style="margin-right:6px" onclick="openResetBracket()">초기화</button>
           <button class="btn-primary" onclick="generateBracket()">재생성</button>`
        : `<button class="btn-primary" onclick="generateBracket()" ${!allPosd ? 'disabled title="6팀 포지션 배정 필요"' : ''}>대진표 생성</button>`
      }
    </div>

    ${!allPosd ? `
      <div class="warn-banner">
        ⚠️ 6개 팀에 포지션(1~6)이 모두 배정되어야 대진표를 생성할 수 있습니다.
        <a onclick="navigate('teams')">팀 관리로 이동</a>
      </div>
    ` : ''}

    <div style="overflow-x:auto">
      <table class="bracket-table">
        <thead>
          <tr>
            <th>세트</th>
            <th style="color:var(--court-a)">COURT A</th>
            <th style="color:var(--court-b)">COURT B</th>
            <th style="color:var(--court-c)">COURT C</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          ${[1,2,3,4,5].map(setNum => {
            const setMatches = state.matches
              .filter(m => m.set_number === setNum)
              .sort((a, b) => a.court < b.court ? -1 : 1);
            const status = getSetStatus(setNum);
            const rowBg  = status === 'completed' ? 'rgba(34,197,94,0.04)'
                         : status === 'pending'   ? 'rgba(0,212,255,0.03)' : '';
            const setColor = status === 'completed' ? 'var(--win)'
                           : status === 'pending'   ? 'var(--accent)' : 'var(--text-muted)';

            return `<tr style="background:${rowBg}">
              <td style="color:${setColor}">SET ${setNum}</td>
              ${['A','B','C'].map(court => {
                const mr = setMatches.find(m => m.court === court);
                if (!mr) return `<td>-</td>`;
                const ta    = getTeamByPosition(mr.position_a);
                const tb    = getTeamByPosition(mr.position_b);
                const score = mr.status === 'completed'
                  ? `<span style="font-size:11px;color:var(--text-muted);margin-left:4px">${mr.score_a}:${mr.score_b}</span>` : '';
                return `<td>${(ta?.name || mr.position_a+'팀')} vs ${(tb?.name || mr.position_b+'팀')}${score}</td>`;
              }).join('')}
              <td>
                <span class="status-badge ${status === 'completed' ? 'status-done' : status === 'pending' ? 'status-active' : 'status-pending'}">
                  ${status === 'completed' ? '완료' : status === 'pending' ? '진행 중' : '대기'}
                </span>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ─────────────────────────────────────────────────────
   렌더 · 순위표
   ───────────────────────────────────────────────────── */
function _rankingHtml() {
  const rankings = calcRankings();
  const done     = state.matches.filter(m => m.status === 'completed').length;
  const total    = state.matches.length || 15;
  const pct      = total > 0 ? Math.round(done / total * 100) : 0;
  const rankClass = ['rank-1', 'rank-2', 'rank-3'];

  return `
    <div style="margin-bottom:12px; font-size:12px; color:var(--text-muted)">
      정렬 기준: 승 수 → 득점 → 실점 → 여성 선수 수 &nbsp;|&nbsp; 완료된 경기 기준 집계
    </div>

    <table class="rank-table">
      <thead>
        <tr>
          <th>순위</th>
          <th>팀명</th>
          <th>승</th>
          <th>패</th>
          <th>득점</th>
          <th>실점</th>
          <th>득실차</th>
          <th>여성 수</th>
        </tr>
      </thead>
      <tbody>
        ${rankings.map((s, i) => {
          const diff = s.scoreFor - s.scoreAgainst;
          return `
            <tr>
              <td><span class="rank-num ${rankClass[i] || ''}">${i + 1}</span></td>
              <td style="font-weight:700">
                ${s.team.name}
                ${s.team.position ? `<span style="font-size:10px;color:var(--text-muted)">#${s.team.position}</span>` : ''}
              </td>
              <td><span class="win-count">${s.wins}</span></td>
              <td><span class="lose-count">${s.losses}</span></td>
              <td><span class="score-stat">${s.scoreFor}</span></td>
              <td><span class="score-stat">${s.scoreAgainst}</span></td>
              <td><span class="score-stat ${diff >= 0 ? 'diff-plus' : 'diff-minus'}">${diff >= 0 ? '+' : ''}${diff}</span></td>
              <td><span style="color:var(--accent2)">${s.femaleCount}명</span></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>

    <div style="margin-top:16px; padding:14px; background:var(--surface2); border-radius:8px; border:1px solid var(--border)">
      <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px">
        <span style="color:var(--text-muted)">경기 진행률</span>
        <span style="color:var(--accent); font-weight:700">${done} / ${total}경기 완료</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

function renderRanking() {
  document.getElementById('view-ranking').innerHTML = _rankingHtml();
}

/* ─────────────────────────────────────────────────────
   헤더 상태 업데이트
   ───────────────────────────────────────────────────── */
function updateHeaderStatus() {
  const done  = state.matches.filter(m => m.status === 'completed').length;
  const total = state.matches.length;
  const dot   = document.getElementById('status-dot');
  const lbl   = document.getElementById('status-label');

  if (!total) {
    lbl.textContent = '경기 준비 중';
  } else if (done === total) {
    lbl.textContent = '전체 경기 완료 🏆';
    dot.className   = 'status-dot online';
  } else {
    // 현재 진행 중인 세트 찾기
    let curSet = 1;
    for (let s = 1; s <= 5; s++) {
      if (getSetStatus(s) !== 'completed') { curSet = s; break; }
    }
    lbl.textContent = `경기 진행 중 · SET ${curSet}`;
  }
}

/* ─────────────────────────────────────────────────────
   모달 헬퍼
   ───────────────────────────────────────────────────── */
function showModal(id) {
  document.getElementById('modal-backdrop').classList.add('active');
  document.getElementById(id).classList.add('active');
}

function closeAllModals() {
  document.getElementById('modal-backdrop').classList.remove('active');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

let _confirmCb = null;
// altLabel: 두 번째 버튼 텍스트 (없으면 단일 버튼)
// onAlt:    두 번째 버튼 클릭 콜백
function openConfirm(msg, onOk, altLabel, onAlt) {
  document.getElementById('confirm-message').textContent = msg;
  _confirmCb = onOk;
  document.getElementById('btn-confirm-ok').onclick = async () => {
    closeAllModals();
    if (_confirmCb) await _confirmCb();
  };
  const altBtn = document.getElementById('btn-confirm-alt');
  if (altLabel && onAlt) {
    altBtn.textContent = altLabel;
    altBtn.style.display = '';
    altBtn.onclick = async () => {
      closeAllModals();
      await onAlt();
    };
  } else {
    altBtn.style.display = 'none';
    altBtn.onclick = null;
  }
  showModal('modal-confirm');
}

// ESC 키로 모달 닫기
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAllModals();
});

/* ─────────────────────────────────────────────────────
   토스트
   ───────────────────────────────────────────────────── */
let _toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast active ${type}`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('active'), 3000);
}

/* ─────────────────────────────────────────────────────
   드래그앤드롭 · 팀 배정
   ───────────────────────────────────────────────────── */
let _dragPlayerId = null;

function onDragStart(event, playerId) {
  _dragPlayerId = playerId;
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.classList.add('dragging');
}

function onDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.team-card').forEach(c => c.classList.remove('drag-over'));
}

function onDragOver(event, teamCardEl) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.team-card').forEach(c => c.classList.remove('drag-over'));
  teamCardEl.classList.add('drag-over');
}

function onDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

async function onDrop(event, teamId) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if (!_dragPlayerId) return;

  const { error } = await sb.from('players')
    .update({ team_id: teamId })
    .eq('id', _dragPlayerId);

  _dragPlayerId = null;
  if (error) { showToast('배정 실패: ' + error.message, 'error'); return; }

  await loadAll();
  renderTeams();
  showToast('팀 배정 완료');
}

/* ─────────────────────────────────────────────────────
   마스터 명단 가져오기 (76mintonapp DB)
   ───────────────────────────────────────────────────── */
const MASTER_URL = 'https://jcthdhhwydwbnppwzzey.supabase.co';
const MASTER_KEY = 'sb_publishable_vF4WX27TEGBARd9Cx8ah_g_gRtfjwrx';

let _masterPlayers = []; // 가져온 마스터 명단 캐시

async function openImportModal() {
  showModal('modal-import');
  document.getElementById('import-summary').textContent = '불러오는 중...';
  document.getElementById('import-list').innerHTML = '<div style="padding:20px; color:var(--text-muted); text-align:center">로딩 중...</div>';

  try {
    const res = await fetch(
      `${MASTER_URL}/rest/v1/members?select=name,gender,level,member_type,is_active&is_active=eq.true&order=name`,
      { headers: { apikey: MASTER_KEY, Authorization: `Bearer ${MASTER_KEY}` } }
    );
    const data = await res.json();
    _masterPlayers = data;

    // 이미 등록된 이름 목록
    const existingNames = new Set(state.players.map(p => p.name));

    const newCount = data.filter(p => !existingNames.has(p.name)).length;
    document.getElementById('import-summary').textContent =
      `총 ${data.length}명 · 미등록 ${newCount}명`;

    const list = document.getElementById('import-list');
    list.innerHTML = data.map((p, i) => {
      const already  = existingNames.has(p.name);
      const gender   = p.gender === '남' ? 'male' : 'female';
      const genderLbl = p.gender === '남' ? 'M' : 'F';
      const isGuest  = p.member_type === '게스트';

      return `
        <label class="import-row ${already ? 'already' : ''}" title="${already ? '이미 등록된 선수' : ''}">
          <input type="checkbox" class="import-chk" data-idx="${i}"
            ${already ? 'disabled' : ''}
            ${already ? '' : 'checked'}>
          <span class="gender-badge ${gender}" style="font-size:10px">${genderLbl}</span>
          <span style="font-weight:500">${p.name}</span>
          <span class="level-badge">${p.level}</span>
          ${isGuest ? '<span class="guest-badge">G</span>' : ''}
          ${already ? '<span style="font-size:10px; color:var(--text-muted); margin-left:auto">이미 등록됨</span>' : ''}
        </label>
      `;
    }).join('');

  } catch (err) {
    document.getElementById('import-list').innerHTML =
      `<div style="padding:20px; color:var(--lose)">불러오기 실패: ${err.message}</div>`;
  }
}

function toggleSelectAll(checked) {
  document.querySelectorAll('.import-chk:not(:disabled)').forEach(cb => cb.checked = checked);
}

async function importSelected() {
  const selected = [];
  document.querySelectorAll('.import-chk:checked:not(:disabled)').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    selected.push(_masterPlayers[idx]);
  });

  if (!selected.length) { showToast('가져올 선수를 선택하세요', 'error'); return; }

  const rows = selected.map(p => ({
    name:       p.name,
    gender:     p.gender === '남' ? 'male' : 'female',
    level:      p.level,
    team_id:    null,
    is_captain: false,
    is_guest:   p.member_type === '게스트',
    is_active:  true,
  }));

  const { error } = await sb.from('players').insert(rows);
  if (error) { showToast('가져오기 실패: ' + error.message, 'error'); return; }

  closeAllModals();
  await loadAll();
  renderView(state.currentView);
  showToast(`${rows.length}명 등록 완료`);
}

/* ─────────────────────────────────────────────────────
   초기화
   ───────────────────────────────────────────────────── */
async function init() {
  const dot = document.getElementById('status-dot');
  const lbl = document.getElementById('status-label');

  // 로딩 표시
  document.getElementById('view-match').innerHTML = '<div class="loading"><div class="spinner"></div> 데이터 로딩 중...</div>';
  document.getElementById('view-match').classList.add('active');
  document.getElementById('nav-match').classList.add('active');

  try {
    await loadAll();

    dot.className   = 'status-dot online';

    // 시작 뷰: 대진표 있으면 경기현황, 없으면 팀관리
    const startView = state.matches.length > 0 ? 'match' : 'teams';

    // 현재 진행 중인 세트 계산
    if (state.matches.length > 0) {
      state.currentSet = 1;
      for (let s = 1; s <= 5; s++) {
        if (getSetStatus(s) !== 'completed') { state.currentSet = s; break; }
      }
    }

    navigate(startView);
    updateHeaderStatus();

  } catch (err) {
    dot.className   = 'status-dot error';
    lbl.textContent = 'DB 연결 오류';
    document.getElementById('view-match').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p style="color:var(--lose)">Supabase 연결 실패</p>
        <p style="margin-top:8px; font-size:12px">${err.message}</p>
        <p style="margin-top:8px; font-size:12px; color:var(--text-muted)">
          db_schema.sql을 Supabase SQL Editor에서 실행했는지 확인하세요.
        </p>
      </div>
    `;
    console.error('Init error:', err);
  }
}

init();
