import { describe, expect, it } from 'vitest';
import { chapters, copyableCode, docsHref, docsLocation, resolveDocImage, resolveDocLink, searchDocs } from './model';

describe('bundled documentation navigation', () => {
  it('keeps quick start, installation and each stable topic available', () => {
    expect(chapters[0].id).toBe('getting-started');
    expect(chapters[0].markdown.length).toBeLessThan(3000);
    for (const id of ['installation', 'foundations', 'configuration', 'runners', 'projects', 'operations', 'recovery', 'evolution']) expect(chapters.some(chapter => chapter.id === id)).toBe(true);
    expect(new Set(chapters.map(chapter => chapter.id)).size).toBe(chapters.length);
  });

  it('opens deep links and falls back safely for an unknown chapter', () => {
    expect(docsLocation('#docs/installation/04-find-the-signature-server-address-and-actual-credentials').chapter.id).toBe('installation');
    expect(docsLocation('#docs/unknown').chapter.id).toBe('getting-started');
    expect(docsLocation('#docs/projects/%invalid').anchor).toBe('');
    expect(docsHref('projects', 'create-a-project')).toBe('#docs/projects/create-a-project');
  });

  it('keeps relative and repository Markdown links inside the reader', () => {
    const installation = chapters.find(chapter => chapter.id === 'installation')!;
    expect(resolveDocLink('RECOVERY_CONTRACT.md#verification-boundaries', installation)).toBe('#docs/seed-recovery/verification-boundaries');
    expect(resolveDocLink('#2-setting-up-gitlab-runners', installation)).toBe('#docs/runners/2-setting-up-gitlab-runners');
    expect(resolveDocLink('https://github.com/kihyoun/system/blob/master/docs/HANDBOOK.md#5-evolving-a-running-system', installation)).toBe('#docs/evolution/5-evolving-a-running-system');
    expect(resolveDocLink('https://docs.gitlab.com/', installation)).toBe('https://docs.gitlab.com/');
    expect(resolveDocImage('images/getting-started/00-overview.png', installation)).toMatch(/^data:image\/png;base64,/);
  });

  it('searches detailed guides and provides a useful snippet and section target', () => {
    const result = searchDocs('checksummed completion manifest').find(result => result.chapter.id === 'configuration');
    expect(result?.snippet).toContain('checksummed completion manifest');
    expect(searchDocs('restored private Wizard image').some(result => result.chapter.id === 'seed-recovery')).toBe(true);
    expect(searchDocs('PERSISTENT_DIR').some(result => result.chapter.id === 'storage')).toBe(true);
    expect(searchDocs('not-a-real-term-98765')).toEqual([]);
    expect(searchDocs('   ')).toEqual([]);
  });

  it.each(['WIZARD_IMAGE', 'persistent_dir', 'sYnC_uSeR'])('finds the actual technical identifier %s regardless of case', identifier => {
    const results = searchDocs(identifier);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(result => result.snippet.toLowerCase().includes(identifier.toLowerCase()))).toBe(true);
  });

  it('copies commands without transcript prompts or output and leaves output-only blocks uncopyable', () => {
    expect(copyableCode('$ docker ps\nCONTAINER ID  IMAGE\n$ echo ready\nready\n', 'console')).toBe('docker ps\necho ready');
    expect(copyableCode('PS C:\\> git --version\ngit version 2.0\n', 'powershell')).toBe('git --version');
    expect(copyableCode('server listening on http://<internal-container-ip>:8071\n', 'text')).toBeUndefined();
    expect(copyableCode("sudo tee config <<'EOF'\nVALUE=example\nEOF\n", 'bash')).toBe("sudo tee config <<'EOF'\nVALUE=example\nEOF");
  });
});
