-- 운명의 짝궁 매칭 (시작 시 전체 게임 편성 → 코트가 비면 순서/코트 배정) — Supabase SQL Editor에서 실행
-- 처음 설치할 때와 이전 버전에서 업그레이드할 때 모두 이 파일을 그대로 실행하면 됩니다.
-- (기존 데이터는 지우지 않습니다)

CREATE TABLE IF NOT EXISTS destiny_matches (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seq         INT UNIQUE,                                 -- 시작된 게임의 순번 (편성만 된 게임은 NULL)
  court       TEXT CHECK (court IN ('A','B','C')),        -- 시작 전에는 NULL
  t1_p1       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  t1_p2       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  t2_p1       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  t2_p2       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','playing','done')),
  t1_score    INT,
  t2_score    INT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  is_final    BOOLEAN NOT NULL DEFAULT false              -- 최종경기 결과 행
);

-- 이전 버전(seq/court 필수, status는 playing/done만) 업그레이드
ALTER TABLE destiny_matches ALTER COLUMN seq   DROP NOT NULL;
ALTER TABLE destiny_matches ALTER COLUMN court DROP NOT NULL;
ALTER TABLE destiny_matches ALTER COLUMN status SET DEFAULT 'planned';
ALTER TABLE destiny_matches DROP CONSTRAINT IF EXISTS destiny_matches_status_check;
ALTER TABLE destiny_matches ADD  CONSTRAINT destiny_matches_status_check CHECK (status IN ('planned','playing','done'));

ALTER TABLE destiny_matches ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT false;

-- 게임 멤버를 대기로 뺄 수 있도록 선수 칸은 빈 자리(NULL)를 허용
ALTER TABLE destiny_matches ALTER COLUMN t1_p1 DROP NOT NULL;
ALTER TABLE destiny_matches ALTER COLUMN t1_p2 DROP NOT NULL;
ALTER TABLE destiny_matches ALTER COLUMN t2_p1 DROP NOT NULL;
ALTER TABLE destiny_matches ALTER COLUMN t2_p2 DROP NOT NULL;

-- 코트당 진행 중인 게임은 1개만 (중복 클릭 방지)
CREATE UNIQUE INDEX IF NOT EXISTS destiny_one_playing_per_court ON destiny_matches(court) WHERE status = 'playing';

ALTER TABLE destiny_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON destiny_matches;
CREATE POLICY "allow_all" ON destiny_matches FOR ALL TO anon USING (true) WITH CHECK (true);

-- 마스터 설정 (승리 점수 등) — key/value
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON app_settings;
CREATE POLICY "allow_all" ON app_settings FOR ALL TO anon USING (true) WITH CHECK (true);
INSERT INTO app_settings (key, value) VALUES ('win_score', '25') ON CONFLICT (key) DO NOTHING;
