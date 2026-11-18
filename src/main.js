const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { open, importColorsCsv } = require('./db');
const { calcCones } = require('./calc');

let db;

const EMPLOYEE_FIELDS = ['name', 'phone', 'role', 'salary', 'join_date', 'active'];
const pick = (obj, keys) => keys.map((k) => obj[k] ?? null);

// Every renderer request goes through here. Add a module = add entries.
const handlers = {
  'employees:list': () => db.prepare('SELECT * FROM employees ORDER BY active DESC, name').all(),
  'employees:save': (e) => {
    if (!e?.name?.trim()) throw new Error('Name is required');
    const vals = pick({ ...e, active: e.active ? 1 : 0 }, EMPLOYEE_FIELDS);
    if (e.id) {
      db.prepare(`UPDATE employees SET ${EMPLOYEE_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...vals, e.id);
    } else {
      db.prepare(`INSERT INTO employees (${EMPLOYEE_FIELDS}) VALUES (${EMPLOYEE_FIELDS.map(() => '?')})`).run(...vals);
    }
  },
  'employees:delete': (id) => db.prepare('DELETE FROM employees WHERE id = ?').run(id),

  'colors:list': () =>
    db.prepare(
      `SELECT c.*, COALESCE(SUM(m.qty), 0) AS stock
       FROM colors c LEFT JOIN stock_movements m ON m.color_id = c.id
       GROUP BY c.id ORDER BY c.code`
    ).all(),
  'colors:save': (c) => {
    if (!/^\d{4}$/.test(c?.code ?? '')) throw new Error('Colour code must be 4 digits');
    db.prepare(
      `INSERT INTO colors (code, name, hex, cone_length_m) VALUES (?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, hex = excluded.hex, cone_length_m = excluded.cone_length_m`
    ).run(c.code, c.name || '', c.hex || '', Number(c.cone_length_m) || 5000);
  },
  'colors:import': async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'CSV', extensions: ['csv'] }] });
    return canceled ? 0 : importColorsCsv(db, filePaths[0]);
  },

  'stock:move': ({ color_id, qty, reason }) => {
    if (!Number.isInteger(qty) || qty === 0) throw new Error('Quantity must be a whole number, not 0');
    db.prepare('INSERT INTO stock_movements (color_id, qty, reason) VALUES (?, ?, ?)').run(color_id, qty, reason || '');
  },
  'stock:history': (color_id) =>
    db.prepare('SELECT * FROM stock_movements WHERE color_id = ? ORDER BY id DESC LIMIT 100').all(color_id),

  calc: (input) => calcCones(input),
  'designs:list': () =>
    db.prepare(
      `SELECT d.*,
         (SELECT group_concat(color_id) FROM (SELECT color_id FROM design_colors WHERE design_id = d.id ORDER BY position)) AS color_ids,
         (SELECT group_concat(coalesce(stitches, '')) FROM (SELECT stitches FROM design_colors WHERE design_id = d.id ORDER BY position)) AS color_stitches
       FROM designs d ORDER BY d.id DESC`
    ).all(),
  // Insert, or update when d.id is set. colorIds[i] uses colorStitches[i] stitches. Returns the design id.
  'designs:save': (d) => {
    if (!d?.name?.trim()) throw new Error('Design name is required');
    const colorIds = d.colorIds ?? [];
    if (colorIds.length !== d.colorStitches?.length) throw new Error('Each colour needs its stitches');
    const r = calcCones(d); // also validates every number
    const vals = [d.name.trim(), r.stitches, colorIds.length, d.heads, d.pieces || 1, JSON.stringify(r), d.metersPer1000Stitches, d.coneLengthM];
    const cols = 'name, stitches, colors, heads, pieces, result_json, meters_per_1000, cone_length_m';
    return db.transaction(() => {
      let id = d.id;
      if (id) {
        db.prepare(`UPDATE designs SET ${cols.split(', ').map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...vals, id);
        db.prepare('DELETE FROM design_colors WHERE design_id = ?').run(id);
      } else {
        id = db.prepare(`INSERT INTO designs (${cols}) VALUES (${vals.map(() => '?')})`).run(...vals).lastInsertRowid;
      }
      const add = db.prepare('INSERT INTO design_colors (design_id, color_id, position, stitches) VALUES (?, ?, ?, ?)');
      colorIds.forEach((cid, i) => add.run(id, cid, i, d.colorStitches[i]));
      return Number(id);
    })();
  },
  'designs:delete': (id) => db.prepare('DELETE FROM designs WHERE id = ?').run(id),

  backup: async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `hafiz-sab-backup-${new Date().toISOString().slice(0, 10)}.db`,
    });
    if (!canceled) await db.backup(filePath);
    return !canceled;
  },
};

app.whenReady().then(() => {
  // userData survives app updates; never store the DB inside the app folder
  db = open(path.join(app.getPath('userData'), 'shop.db'));
  for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(name, (_e, arg) => fn(arg));

  // Installed builds take the icon from build/icon.png via electron-builder; this covers `npm start`.
  const icon = path.join(__dirname, '..', 'build', 'icon.png');
  if (!app.isPackaged) app.dock?.setIcon(icon);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: app.isPackaged ? undefined : icon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
});

app.on('window-all-closed', () => {
  db?.close();
  app.quit();
});
