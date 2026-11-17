CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE languages (
  code VARCHAR(10) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  native_name VARCHAR(50) NOT NULL,
  tts_voice VARCHAR(60),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order SMALLINT NOT NULL DEFAULT 0
);
INSERT INTO languages (code, name, native_name, tts_voice, sort_order) VALUES
  ('vi','Vietnamese','Tieng Viet','vi-VN-HoaiMyNeural',1),
  ('en','English','English','en-US-JennyNeural',2),
  ('zh-CN','Chinese (Simplified)','中文','zh-CN-XiaoxiaoNeural',3),
  ('ja','Japanese','日本語','ja-JP-NanamiNeural',4),
  ('ko','Korean','한국어','ko-KR-SunHiNeural',5),
  ('fr','French','Francais','fr-FR-DeniseNeural',6);

CREATE TABLE poi_categories (
  id SMALLSERIAL PRIMARY KEY,
  code VARCHAR(30) UNIQUE NOT NULL,
  icon_url TEXT,
  color VARCHAR(7)
);
INSERT INTO poi_categories (code, color) VALUES ('STATUE','#d97706'),('HALL','#b91c1c'),('FACILITY','#2563eb');

CREATE TABLE pois (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) UNIQUE NOT NULL,
  category_id SMALLINT REFERENCES poi_categories(id),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  location GEOGRAPHY(Point,4326) NOT NULL,
  trigger_radius_m SMALLINT NOT NULL DEFAULT 20 CHECK (trigger_radius_m BETWEEN 5 AND 200),
  priority SMALLINT NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  thumbnail_url TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pois_location ON pois USING GIST (location);

CREATE TABLE poi_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id UUID NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  lang_code VARCHAR(10) NOT NULL REFERENCES languages(code),
  name VARCHAR(200) NOT NULL DEFAULT '',
  short_description VARCHAR(500) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  audio_url TEXT,
  audio_duration_sec INT,
  audio_format VARCHAR(10) DEFAULT 'mp3',
  is_source BOOLEAN NOT NULL DEFAULT false,
  translation_origin VARCHAR(10) NOT NULL DEFAULT 'MACHINE' CHECK (translation_origin IN ('SOURCE','MACHINE','HUMAN')),
  status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','TRANSLATED','AUDIO_READY','REVIEWED','FAILED')),
  content_hash CHAR(64),
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poi_id, lang_code)
);

CREATE TABLE poi_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id UUID NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  media_type VARCHAR(10) NOT NULL DEFAULT 'IMAGE',
  url TEXT NOT NULL,
  caption VARCHAR(255),
  display_order SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE tours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) UNIQUE NOT NULL,
  estimated_duration_min INT,
  total_distance_m INT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_customizable BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tour_translations (
  tour_id UUID NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  lang_code VARCHAR(10) NOT NULL REFERENCES languages(code),
  name VARCHAR(150) NOT NULL,
  description TEXT,
  PRIMARY KEY (tour_id, lang_code)
);

CREATE TABLE tour_pois (
  tour_id UUID NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  seq_no SMALLINT NOT NULL,
  poi_id UUID NOT NULL REFERENCES pois(id),
  suggested_stay_min SMALLINT NOT NULL DEFAULT 5,
  PRIMARY KEY (tour_id, seq_no),
  UNIQUE (tour_id, poi_id)
);

CREATE TABLE route_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id UUID NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  from_poi_id UUID NOT NULL REFERENCES pois(id),
  to_poi_id UUID NOT NULL REFERENCES pois(id),
  path GEOGRAPHY(LineString,4326),
  distance_m INT,
  walking_time_sec INT,
  UNIQUE (tour_id, from_poi_id, to_poi_id)
);

CREATE TABLE route_segment_translations (
  segment_id UUID NOT NULL REFERENCES route_segments(id) ON DELETE CASCADE,
  lang_code VARCHAR(10) NOT NULL REFERENCES languages(code),
  instruction TEXT NOT NULL,
  PRIMARY KEY (segment_id, lang_code)
);

CREATE TABLE content_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_id UUID NOT NULL REFERENCES poi_translations(id) ON DELETE CASCADE,
  job_type VARCHAR(10) NOT NULL CHECK (job_type IN ('TRANSLATE','TTS')),
  status VARCHAR(10) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED')),
  attempts SMALLINT NOT NULL DEFAULT 0,
  provider VARCHAR(30),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_jobs_queue ON content_jobs (status, created_at);

CREATE TABLE dataset_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no INT UNIQUE NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'BUILDING' CHECK (status IN ('BUILDING','PUBLISHED','FAILED')),
  bundle_url TEXT,
  checksum CHAR(64),
  poi_count INT,
  language_count INT,
  published_by UUID,
  published_at TIMESTAMPTZ
);

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(30) NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
