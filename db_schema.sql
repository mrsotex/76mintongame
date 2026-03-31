-- =====================================================
-- 민사친76 배드민턴 매칭 시스템 · DB 스키마
-- Supabase SQL Editor에서 실행하세요
-- =====================================================

-- 기존 테이블 초기화 (재실행 시 사용)
DROP TABLE IF EXISTS game_assignments CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS teams CASCADE;

-- ── 팀 테이블 ──────────────────────────────────────
CREATE TABLE teams (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name      TEXT NOT NULL,
  position  INT  UNIQUE CHECK (position BETWEEN 1 AND 6),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 선수 테이블 ────────────────────────────────────
CREATE TABLE players (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  gender     TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  level      TEXT CHECK (level IN ('A', 'B', 'C', 'D', 'E')),
  team_id    UUID REFERENCES teams(id) ON DELETE SET NULL,
  is_captain BOOLEAN DEFAULT FALSE,
  is_guest   BOOLEAN DEFAULT FALSE,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 경기 테이블 (대진표) ───────────────────────────
-- position_a / position_b: 팀 포지션 번호 (1~6)
CREATE TABLE matches (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  set_number  INT  NOT NULL CHECK (set_number BETWEEN 1 AND 5),
  court       TEXT NOT NULL CHECK (court IN ('A', 'B', 'C')),
  position_a  INT  NOT NULL CHECK (position_a BETWEEN 1 AND 6),
  position_b  INT  NOT NULL CHECK (position_b BETWEEN 1 AND 6),
  score_a     INT,
  score_b     INT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(set_number, court)
);

-- ── 경기 선수 배정 테이블 ─────────────────────────
-- 경기당 팀별 2명 선수 배정 정보
CREATE TABLE game_assignments (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id   UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id    UUID NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  player1_id UUID NOT NULL REFERENCES players(id),
  player2_id UUID NOT NULL REFERENCES players(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(match_id, team_id)
);

-- ── RLS 설정 (anon 전체 접근 허용) ───────────────
ALTER TABLE teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE players          ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON teams            FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON players          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON matches          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON game_assignments FOR ALL TO anon USING (true) WITH CHECK (true);
