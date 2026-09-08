const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const mode = args[0] || 'verify';
const rootIndex = args.indexOf('--root');
const root = path.resolve(rootIndex >= 0 && args[rootIndex + 1]
  ? args[rootIndex + 1]
  : path.join(__dirname, '..', '..'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function artifact(relativePath) {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  if (!fs.existsSync(absolutePath)) throw new Error(`Missing release artifact: ${absolutePath}`);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) throw new Error(`Release artifact is not a file: ${absolutePath}`);
  return { path: relativePath, bytes: stat.size, sha256: sha256(absolutePath) };
}

function currentState() {
  const pkg = readJson(path.join(root, 'app', 'package.json'));
  const lock = readJson(path.join(root, 'app', 'package-lock.json'));
  const product = pkg.build.productName;
  const installer = `dist/${product} Setup ${pkg.version}.exe`;
  const files = [
    artifact('61.html'),
    artifact('replacement/61.html'),
    artifact('Music-Visualisation-Claude-Code-Replace.zip'),
    artifact('dist/win-unpacked/resources/app/61.html'),
    artifact(`dist/win-unpacked/${product}.exe`),
    artifact(installer)
  ];

  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error(`VERSION DRIFT: package=${pkg.version}, lock=${lock.version}, lock root=${lock.packages?.['']?.version}`);
  }
  const byPath = Object.fromEntries(files.map(file => [file.path, file]));
  const sourceHash = byPath['61.html'].sha256;
  if (byPath['replacement/61.html'].sha256 !== sourceHash) {
    throw new Error('STALE REPLACEMENT: replacement/61.html differs from root 61.html.');
  }
  if (byPath['dist/win-unpacked/resources/app/61.html'].sha256 !== sourceHash) {
    throw new Error('STALE BUILD: packaged 61.html differs from root 61.html.');
  }

  return {
    schemaVersion: 1,
    app: { name: pkg.name, productName: product, version: pkg.version },
    artifacts: files
  };
}

function sameArtifact(expected, actual) {
  return expected.path === actual.path &&
    expected.bytes === actual.bytes &&
    expected.sha256 === actual.sha256;
}

try {
  const manifestPath = path.join(root, 'dist', 'release-integrity.json');
  const state = currentState();
  if (mode === 'generate') {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({
      ...state,
      generatedAt: new Date().toISOString()
    }, null, 2) + '\n');
    console.log(`PASS: generated release integrity manifest for ${state.app.productName} ${state.app.version}.`);
  } else if (mode === 'verify') {
    if (!fs.existsSync(manifestPath)) throw new Error(`Missing release integrity manifest: ${manifestPath}`);
    const saved = readJson(manifestPath);
    if (saved.schemaVersion !== state.schemaVersion ||
        saved.app?.name !== state.app.name ||
        saved.app?.productName !== state.app.productName ||
        saved.app?.version !== state.app.version) {
      throw new Error('STALE RELEASE MANIFEST: application metadata does not match the current package.');
    }
    if (!Array.isArray(saved.artifacts) || saved.artifacts.length !== state.artifacts.length ||
        !state.artifacts.every((item, index) => sameArtifact(item, saved.artifacts[index]))) {
      throw new Error('RELEASE INTEGRITY FAILURE: an artifact is missing, stale, or changed after validation.');
    }
    console.log(`PASS: release integrity verified for ${state.app.productName} ${state.app.version}.`);
  } else {
    throw new Error(`Unknown mode "${mode}". Use generate or verify.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

