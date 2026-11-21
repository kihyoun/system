/** Compiled image adapter for retained managed environment recipes. */
import { parse } from '../modules/project-lifecycle/environment-runtime';
import { environmentMain } from '../modules/project-lifecycle/environment-entry';
export * from '../modules/project-lifecycle/environment-runtime';
if (require.main === module) {
  try {
    const request = parse(process.argv.slice(2));
    void environmentMain(request)
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error: unknown) => {
        console.error(
          JSON.stringify({
            state: 'failed',
            message: error instanceof Error ? error.message : 'environment-operation-failed',
          }),
        );
        process.exitCode = 1;
      });
  } catch {
    console.error('Invalid managed environment invocation.');
    process.exitCode = 2;
  }
}
