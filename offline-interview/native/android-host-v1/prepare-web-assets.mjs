import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const offlineInterview = path.resolve(here, '../..');
const productDir = path.join(offlineInterview, 'beta-v41-23');
const targetDir = path.join(here, 'app', 'src', 'main', 'assets', 'web');
const productSourceHead = '25493983644b3fecbc36c3483b1d11c48f268c09';
const providerId = 'ANDROID_SYSTEM_DEFAULT_V3_DRAFT';

execFileSync(process.execPath, [path.join(productDir, 'build-runtime.mjs')], { stdio: 'inherit' });

const files = [
  'index.html',
  'shell.html',
  'app.js',
  'styles.css',
  'transcription-engine.js',
  'system-stt.js',
  'speech-network-failfast.js',
  'audio-window.js',
  'direct-interview-link.js',
  'whisper-quality.js',
  'interview.json',
  'manifest.webmanifest',
  'icon.svg',
  'sw.js',
  'INTERVIEW_FORMAT.md',
  'INTERVIEW_AUTHORING_KIT.md',
  'interview-spec.schema.json'
];

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

const hashes = {};
for (const name of files) {
  const source = path.join(productDir, name);
  if (!fs.existsSync(source)) throw new Error(`Missing V41.23 runtime asset: ${name}`);
  const bytes = fs.readFileSync(source);
  fs.writeFileSync(path.join(targetDir, name), bytes);
  hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
}

const app = fs.readFileSync(path.join(productDir, 'app.js'), 'utf8');
const buildMatch = app.match(/const BUILD_ID = '([^']+)'/);
if (!buildMatch) throw new Error('Unable to resolve V41.23 BUILD_ID');

const provenance = {
  schema: 'offline-interview.android-host-web-assets.v1',
  productSourceHead,
  webBuildId: buildMatch[1],
  providerId,
  origin: 'https://appassets.androidplatform.net',
  entrypoint: '/assets/web/index.html',
  files: hashes
};
fs.writeFileSync(path.join(targetDir, 'host-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Prepared ${files.length} V41.23 assets for Android host: ${buildMatch[1]}`);
