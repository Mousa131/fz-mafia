CREATE TABLE fs_users (
  id SERIAL PRIMARY KEY,
  uid CHAR(24) UNIQUE,
  name VARCHAR(40) DEFAULT '',
  settings TEXT,
  games INT DEFAULT 0,
  wins INT DEFAULT 0,
  created TIMESTAMP,
  seen TIMESTAMP
);

CREATE TABLE fs_rooms (
  code CHAR(5) PRIMARY KEY,
  host_pid INT DEFAULT 0,
  ed SMALLINT DEFAULT 1,
  status VARCHAR(8) DEFAULT 'lobby',
  phase VARCHAR(8) DEFAULT 'lobby',
  round INT DEFAULT 0,
  phase_end INT DEFAULT 0,
  winner VARCHAR(8) DEFAULT '',
  cfg TEXT,
  data TEXT,
  created TIMESTAMP,
  upd TIMESTAMP
);

CREATE TABLE fs_players (
  id SERIAL PRIMARY KEY,
  room CHAR(5),
  uid CHAR(24),
  name VARCHAR(20),
  av TEXT,
  role VARCHAR(8) DEFAULT '',
  alive SMALLINT DEFAULT 1,
  vote INT NULL,
  act INT NULL,
  info TEXT
);
CREATE INDEX fs_players_room_idx ON fs_players (room);
CREATE INDEX fs_players_uid_idx ON fs_players (uid);

CREATE TABLE fs_chat (
  id SERIAL PRIMARY KEY,
  room CHAR(5),
  pid INT,
  name VARCHAR(20),
  msg VARCHAR(300),
  ch CHAR(1) DEFAULT 'a',
  ts INT
);
CREATE INDEX fs_chat_room_idx ON fs_chat (room);

CREATE TABLE fs_games (
  id SERIAL PRIMARY KEY,
  mode VARCHAR(8),
  room CHAR(5) DEFAULT '',
  players INT,
  winner VARCHAR(8),
  rounds INT,
  uid CHAR(24) DEFAULT '',
  ts TIMESTAMP
);

CREATE TABLE fs_plays (
  id SERIAL PRIMARY KEY,
  uid CHAR(24),
  mode VARCHAR(8),
  role VARCHAR(8) DEFAULT '',
  won SMALLINT NULL,
  rounds INT DEFAULT 0,
  ts TIMESTAMP
);
CREATE INDEX fs_plays_uid_idx ON fs_plays (uid);

CREATE TABLE fs_log (
  id SERIAL PRIMARY KEY,
  ts TIMESTAMP,
  type VARCHAR(20),
  uid CHAR(24),
  room CHAR(5),
  info VARCHAR(255)
);
