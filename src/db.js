const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Each entry runs once, in order; PRAGMA user_version records how many have run.
// Never edit an old migration after release: append a new one.
const MIGRATIONS = [
  `
  CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    role TEXT,
    salary INTEGER,
    join_date TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE colors (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT,
    hex TEXT,
    cone_length_m INTEGER NOT NULL DEFAULT 5000
  );
  -- Stock is the sum of movements: + received, - used. Keeps a full history.
  CREATE TABLE stock_movements (
    id INTEGER PRIMARY KEY,
    color_id INTEGER NOT NULL REFERENCES colors(id),
    qty INTEGER NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE designs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    stitches INTEGER NOT NULL,
    colors INTEGER NOT NULL,
    heads INTEGER NOT NULL,
    pieces INTEGER NOT NULL DEFAULT 1,
    result_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  `,
  `
  -- Which thread colours a design uses, in needle order.
  CREATE TABLE design_colors (
    design_id INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    color_id INTEGER NOT NULL REFERENCES colors(id),
    position INTEGER NOT NULL,
    PRIMARY KEY (design_id, position)
  );
  `,
  `
  -- Thread settings used for the design, so editing it later gives the same result.
  ALTER TABLE designs ADD COLUMN meters_per_1000 REAL NOT NULL DEFAULT 5;
  ALTER TABLE designs ADD COLUMN cone_length_m INTEGER NOT NULL DEFAULT 5000;
  `,
  `
  -- Stitches for each colour (some colours are used much more than others). NULL on designs saved before this.
  ALTER TABLE design_colors ADD COLUMN stitches INTEGER;
  `,
];

function open(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const done = db.pragma('user_version', { simple: true });
  db.transaction(() => {
    MIGRATIONS.slice(done).forEach((sql) => db.exec(sql));
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  })();
  if (done === 0) importColorsCsv(db, path.join(__dirname, '..', 'seed', 'colors.csv'));
  return db;
}

// CSV columns: code,name,hex  (header row required). Existing codes are updated, not duplicated.
function importColorsCsv(db, file) {
  if (!fs.existsSync(file)) return 0;
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter((l) => l.trim());
  const upsert = db.prepare(
    `INSERT INTO colors (code, name, hex) VALUES (?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, hex = excluded.hex`
  );
  db.transaction(() => {
    for (const line of rows) {
      const [code, name = '', hex = ''] = line.split(',').map((s) => s.trim());
      if (code) upsert.run(code, name, hex);
    }
  })();
  return rows.length;
}

module.exports = { open, importColorsCsv };
