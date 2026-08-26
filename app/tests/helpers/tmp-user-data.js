const fs = require('fs');
const os = require('os');
const path = require('path');

// Electron's app.getName() now resolves to the top-level "productName" in
// app/package.json ("SUB REMIX"), so without an explicit --user-data-dir every
// `electron.launch()` in these tests would read/write the REAL user's profile at
// %APPDATA%\SUB REMIX\ — including their actual presets, autosave, and language
// preference. That's not just noisy: a test that does localStorage.clear() would
// destroy real user data.
//
// newUserDataDir() hands back a fresh temp directory to pass as
// `--user-data-dir=<dir>` in electron.launch({ args: [...] }). Call it once per
// test (not once per launch) — restart/persistence tests launch the app twice and
// need BOTH launches to share the same directory, or the "survives restart" test
// becomes meaningless (it would either fail outright or vacuously pass by reading
// back nothing). A fresh dir per launch call would silently defeat what such a
// test is actually checking.
function newUserDataDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `subremix-test-${label}-`));
}

function cleanupUserDataDir(dir) {
  if (!dir) return;
  // Electron may still be flushing LevelDB/Preferences a few ms after app.close()
  // resolves on Windows; retry a couple of times instead of failing the test run
  // over a locked file the OS will release momentarily.
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

module.exports = { newUserDataDir, cleanupUserDataDir };
