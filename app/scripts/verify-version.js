const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback;
}

const appRoot = path.join(__dirname, '..');
const packagePath = option('--package', path.join(appRoot, 'package.json'));
const lockPath = option('--lock', path.join(appRoot, 'package-lock.json'));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read valid JSON from ${file}: ${error.message}`);
  }
}

try {
  const pkg = readJson(packagePath);
  const lock = readJson(lockPath);
  const lockRoot = lock.packages && lock.packages[''];

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version || '')) {
    throw new Error(`Invalid application version in ${packagePath}: ${pkg.version}`);
  }
  if (!lockRoot) {
    throw new Error(`Missing root package entry in ${lockPath}`);
  }

  const versions = [pkg.version, lock.version, lockRoot.version];
  if (!versions.every(version => version === pkg.version)) {
    throw new Error(
      `VERSION DRIFT: package.json=${pkg.version}, package-lock.json=${lock.version}, ` +
      `package-lock root=${lockRoot.version}. Run "npm version patch --no-git-tag-version" ` +
      `or regenerate the lockfile before building.`
    );
  }
  if (pkg.name !== lock.name || pkg.name !== lockRoot.name) {
    throw new Error(
      `PACKAGE NAME DRIFT: package.json=${pkg.name}, package-lock.json=${lock.name}, ` +
      `package-lock root=${lockRoot.name}.`
    );
  }

  console.log(`PASS: package metadata is synchronized at ${pkg.name}@${pkg.version}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

