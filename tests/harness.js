/**
 * The test harness. No framework, no build: it runs in any browser and reports
 * into the page, which is also what makes it readable by a headless run.
 *
 * Every result is kept in `window.__tests` as well as drawn, so the command-line
 * runner reads them over the DevTools protocol instead of scraping markup.
 */

const results = () => document.getElementById('results');

export const report = (window.__tests ||= { results: [], passed: 0, failed: 0, done: false });

function record(name, ok, detail) {
  const li = document.createElement('li');
  li.className = ok ? 'ok' : 'ko';
  li.textContent = name + detail;
  results()?.appendChild(li);
  report.results.push({ name, ok, detail });
  if (ok) report.passed++; else report.failed++;
}

const verdict = (r) => (r === true || r === undefined ? '' : ` — ${r}`);

/** A synchronous test: passes on `true` or nothing, fails on anything else or a throw. */
export function check(name, fn) {
  let detail;
  try {
    detail = verdict(fn());
  } catch (e) {
    detail = ` — ${e.message}`;
  }
  record(name, detail === '', detail);
}

/** The same, awaited. */
export async function checkAsync(name, fn) {
  let detail;
  try {
    detail = verdict(await fn());
  } catch (e) {
    detail = ` — ${e.message}`;
  }
  record(name, detail === '', detail);
}

/** A test file that does not even load is a failure, not a silent gap. */
export function loadFailure(file, e) {
  record(`chargement de ${file}`, false, ` — ${e.message}`);
}

/** Write the summary line, and tell a waiting runner the suite is over. */
export function finish() {
  const { passed, failed } = report;
  const summary = document.getElementById('summary');
  summary.textContent = failed === 0
    ? `${passed} tests réussis.`
    : `${passed} réussis, ${failed} en échec.`;
  summary.className = failed === 0 ? 'green' : 'red';
  document.title = failed === 0 ? `OK ${passed}/${passed}` : `ECHEC ${failed}`;
  report.done = true;
}

/**
 * Run `fn` and collect what it let escape to the window: an exception thrown
 * in an event handler does not reach the caller of dispatchEvent, it is
 * reported instead — and a check around it would pass regardless.
 */
export function uncaught(fn) {
  const seen = [];
  const onError = (e) => seen.push(e.message || String(e.error));
  window.addEventListener('error', onError);
  try {
    fn();
  } finally {
    window.removeEventListener('error', onError);
  }
  return seen;
}
