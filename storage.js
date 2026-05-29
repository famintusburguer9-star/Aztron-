const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, ".data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function filePath(key) { return path.join(DATA_DIR, `${key}.json`); }

function get(key, defaultValue = null) {
  try {
    const p = filePath(key);
    if (!fs.existsSync(p)) return defaultValue;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { return defaultValue; }
}

function set(key, value) {
  try { fs.writeFileSync(filePath(key), JSON.stringify(value, null, 2)); return true; }
  catch { return false; }
}

function del(key) {
  try { const p = filePath(key); if (fs.existsSync(p)) fs.unlinkSync(p); return true; }
  catch { return false; }
}

module.exports = { get, set, del };
