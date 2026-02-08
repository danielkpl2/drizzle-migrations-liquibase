/**
 * Tiny test harness used by all test scripts.
 * No external dependencies — just console colours and an assert helper.
 */

let _passed = 0;
let _failed = 0;
let _currentSuite = '';

export function suite(name) {
  _currentSuite = name;
  console.log(`\n📋 ${name}`);
}

export function assert(condition, label) {
  if (condition) {
    _passed++;
    console.log(`  ✅ ${label}`);
  } else {
    _failed++;
    console.error(`  ❌ ${label}`);
  }
}

export function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    _passed++;
    console.log(`  ✅ ${label}`);
  } else {
    _failed++;
    console.error(`  ❌ ${label}`);
    console.error(`     expected: ${e}`);
    console.error(`     actual:   ${a}`);
  }
}

export function includes(haystack, needle, label) {
  if (typeof haystack === 'string' && haystack.includes(needle)) {
    _passed++;
    console.log(`  ✅ ${label}`);
  } else if (Array.isArray(haystack) && haystack.includes(needle)) {
    _passed++;
    console.log(`  ✅ ${label}`);
  } else {
    _failed++;
    console.error(`  ❌ ${label}`);
    console.error(`     "${needle}" not found`);
  }
}

export function gt(actual, expected, label) {
  if (actual > expected) {
    _passed++;
    console.log(`  ✅ ${label}`);
  } else {
    _failed++;
    console.error(`  ❌ ${label} (${actual} is not > ${expected})`);
  }
}

export function summary() {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${_passed} passed, ${_failed} failed`);
  if (_failed > 0) {
    console.error('💥 Some tests failed!\n');
    process.exit(1);
  }
  console.log('🎉 All tests passed!\n');
  return { passed: _passed, failed: _failed };
}

export function counts() {
  return { passed: _passed, failed: _failed };
}
