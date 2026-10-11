CREATE TABLE IF NOT EXISTS boards (
  id uuid PRIMARY KEY,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  current_seq bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS operations (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  client_id text NOT NULL,
  client_op_id uuid NOT NULL,
  op jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, seq),
  UNIQUE (board_id, client_id, client_op_id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, seq)
);
