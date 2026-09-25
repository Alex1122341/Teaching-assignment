'use strict';
// A non-production lifecycle simulation. Role attestations are synthetic, never AI reviews.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const task = require('./task.js');
const {verify} = require('./verify.js');
const {safePath} = require('./safety.js');

function demonstrate(root = path.resolve(__dirname, '../..')) {
 const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vista-ai-demo-'));
 const git = args => execFileSync('git', args, {cwd: temporary, stdio: 'pipe'});
 try {
  for (const name of ['templates', 'policies', 'prompts', 'schemas']) {
   fs.cpSync(safePath(root, '.ai', name), path.join(temporary, '.ai', name), {recursive: true});
  }
  fs.mkdirSync(path.join(temporary, 'tests'), {recursive: true});
  fs.writeFileSync(path.join(temporary, 'demo-note.md'), '# Fixture note\n');
  // The fixed unit profile uses Node's real TAP reporter, not a fake build marker.
  fs.writeFileSync(path.join(temporary, 'tests/documentation.test.js'),
   "const fs=require('node:fs');require('node:test')('fixture note keeps human approval',()=>{require('node:assert/strict').match(fs.readFileSync('demo-note.md','utf8'),/Human merge only/)});\n");
  for (const args of [['init', '-q'], ['config', 'user.name', 'Synthetic demo'],
   ['config', 'user.email', 'demo@example.test'], ['add', '.'], ['commit', '-qm', 'Synthetic baseline']]) git(args);
  const sample = name => JSON.parse(fs.readFileSync(safePath(root, '.ai', 'examples', 'documentation-demo', name), 'utf8'));
  task.init(temporary, sample('issue.json'));
  task.prompt(temporary, 900001, 'architect');
  task.write(temporary, 900001, 'spec.json', sample('spec.json'));
  task.write(temporary, 900001, '02-architecture-spec.md', '# Synthetic architecture\n\nSee spec.json. No model was called.\n');
  task.advance(temporary, 900001, 'implementation');
  task.prompt(temporary, 900001, 'builder', 'hy4');
  fs.appendFileSync(path.join(temporary, 'demo-note.md'), '\nHuman merge only.\n');
  task.write(temporary, 900001, '03-builder-handoff.md', '# Synthetic builder\n\nChanged demo-note.md in a temporary fixture. No HY4 model was called.\n');
  task.advance(temporary, 900001, 'review');
  task.collect(temporary, 900001);
  task.prompt(temporary, 900001, 'review', 'deepseek');
  const review = (stage, model) => ({
   issue: 900001, stage, model, ...task.context(temporary, 900001),
   criteria: [{id: 'AC1', result: 'PASS', evidence: 'SYNTHETIC DEMO ONLY: fixture note assertion, not a real model review.'}],
   blocking_findings: [], warnings: ['SIMULATION: no AI reviewer participated.'],
   remaining_risk: ['Not an attestation for VISTA or any real PR.'],
   human_checks: ['Use real independent review for actual tasks.'], reviewed_at: new Date().toISOString()
  });
  task.write(temporary, 900001, 'review.json', review('adversarial', 'deepseek'));
  task.write(temporary, 900001, '04-review.md', '# SIMULATED review\n\nSchema fixture only; no DeepSeek model was called.\n');
  task.advance(temporary, 900001, 'verification');
  task.prompt(temporary, 900001, 'integrator');
  const verification = verify(temporary, 900001);
  if (verification.checks.some(check => check.result !== 'PASS')) throw Error('Demonstration verification failed');
  task.advance(temporary, 900001, 'final_review');
  task.prompt(temporary, 900001, 'final-review');
  task.write(temporary, 900001, 'final-review.json', review('final', 'sol'));
  task.write(temporary, 900001, '06-final-review.md', '# SIMULATED final review\n\nSchema fixture only; no Sol model was called.\n');
  task.advance(temporary, 900001, 'ready_for_human');
  if (!task.check(temporary, 900001).ready) throw Error('Demonstration did not reach expected fixture state');
  const output = safePath(root, '.ai', 'generated', path.basename(temporary));
  fs.cpSync(path.join(temporary, '.ai'), output, {recursive: true, errorOnExist: true, force: false});
  return {simulation: true,model_calls: 0,fixture_check: 'PASS',output};
 } finally {
  // Exact directory returned by mkdtemp; never remove a caller-selected path.
  fs.rmSync(temporary, {recursive: true, force: true});
 }
}
if (require.main === module) {
 try { console.log(JSON.stringify(demonstrate(), null, 2)); }
 catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {demonstrate};
