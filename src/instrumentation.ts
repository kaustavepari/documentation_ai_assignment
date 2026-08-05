/**
 * Runs once when the server process starts, before it serves anything.
 *
 * Startup is the only moment this app looks at a flat `git status`. Every other
 * commit decision comes from an editing session it observed; this one cannot,
 * because a crash takes the session map with it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { runStartupRecovery } = await import('@/lib/server/recovery');
  try {
    const report = await runStartupRecovery();
    if (report.kind === 'recovered') {
      console.log(`[notes] recovered ${report.paths.length} unsaved note(s) into ${report.sha.slice(0, 7)}`);
    } else if (report.kind === 'preexisting') {
      console.log(
        `[notes] repo was already dirty at startup — left untouched:\n${report.paths
          .map((p) => `         ${p}`)
          .join('\n')}`,
      );
    }
  } catch (error) {
    console.error('[notes] startup recovery failed:', error);
  }
}
