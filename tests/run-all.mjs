#!/usr/bin/env node
/**
 * DevLifecycle — Unified Test Suite Runner
 *
 * Runs all three verification suites sequentially:
 * 1. tests/run-tests.mjs (v2.0 Core Plugin & Scenario Suite — 12 tests)
 * 2. tests/context-intelligence.test.mjs (v2.1 P13 Context Intelligence Suite — 14 tests)
 * 3. tests/reliability-and-release.test.mjs (v2.1.1 Reliability, SemVer, Packaging & Install Suite — 19 tests)
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const suites = [
  { name: 'v2.0 Core Acceptance Suite', file: path.join(__dirname, 'run-tests.mjs') },
  { name: 'v2.1 P13 Context Intelligence Suite', file: path.join(__dirname, 'context-intelligence.test.mjs') },
  { name: 'v2.1.1 Reliability, SemVer, Packaging & Install Suite', file: path.join(__dirname, 'reliability-and-release.test.mjs') }
];

let failedSuites = 0;

for (const suite of suites) {
  const res = spawnSync(process.execPath, [suite.file], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    windowsHide: true
  });
  if (res.status !== 0) {
    failedSuites++;
  }
  console.log('');
}

if (failedSuites > 0) {
  console.error(`✖ ${failedSuites} test suite(s) failed.`);
  process.exit(1);
}
console.log('✔ All 3 DevLifecycle test suites (45 scenarios) completed without failure.');
