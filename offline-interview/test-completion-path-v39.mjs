import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const spec = JSON.parse(fs.readFileSync(new URL('./test-interviews/interview-test-ux-v39.json', import.meta.url), 'utf8'));

assert.match(app, /interview-runtime-v39/);
assert.match(app, /let completionInProgress = false;/);
assert.match(app, /let pendingInterviewCompletion = false;/);
assert.match(app, /completion_requested/);
assert.match(app, /completion_succeeded/);
assert.match(app, /completion_error/);
assert.match(app, /pendingInterviewCompletion && !nextSpeakerId/);
assert.match(app, /ui\.mobileFinishBtn\?\.addEventListener\('click', completeInterview\)/);
assert.match(app, /ui\.sidebarFinishBtn\?\.addEventListener\('click', completeInterview\)/);
assert.match(css, /@media\(max-width:979px\)\{\.mobile-finish-button\{display:inline-flex/);
assert.doesNotMatch(css, /@media\(max-width:759px\)\{\.mobile-finish-button\{display:inline-flex/);
assert.match(index, /id="doneView"/);
assert.match(index, /id="exportJsonBtn"/);
assert.equal(spec.id, 'test-ux-v39-completion-state');
console.log('PASS V39 completion path contract');
