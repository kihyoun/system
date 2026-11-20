const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');

test('German docs compiler rejects stale, missing, summarized or technically changed translations', async () => {
  const { compile } = await import('../../scripts/compile-docs-locales.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-docs-locales-'));
  const source = '# Setup\n\nUse `SEED_DIR` and the [guide](#docs/recovery).\n\n| Key | Meaning |\n| --- | --- |\n| `SEED_DIR` | Backup directory |\n\n```sh\nrsync --delete "$SOURCE/" "$TARGET/"\n```\n';
  const translation = '# Einrichtung\n\nVerwenden Sie `SEED_DIR` und die [Anleitung](#docs/recovery).\n\n| Schlüssel | Bedeutung |\n| --- | --- |\n| `SEED_DIR` | Sicherungsverzeichnis |\n\n```sh\nrsync --delete "$SOURCE/" "$TARGET/"\n```\n';
  const dir = path.join(root, 'src/docs/locales/de');
  fs.mkdirSync(dir, { recursive: true });
  const content = { chapters: [{ id: 'setup', markdown: source }] };
  const contentFile = path.join(root, 'src/docs/content.json');
  const translationFile = path.join(dir, 'setup.md');
  fs.writeFileSync(contentFile, JSON.stringify(content));
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({ setup: crypto.createHash('sha256').update(source).digest('hex') }));
  try {
    fs.writeFileSync(translationFile, translation);
    assert.equal(compile(root).chapters.setup.markdown, translation);
    for (const broken of [
      translation.replace('--delete', '--archive'), translation.replace('`SEED_DIR`', '`PERSISTENT_DIR`'),
      translation.replace('#docs/recovery', '#docs/storage'), translation.replace('# Einrichtung', '## Einrichtung'),
      translation.replace('| Schlüssel | Bedeutung |', '| Schlüssel | Bedeutung | Zusätzliche Spalte |'),
      '# Einrichtung\n\nZusammenfassung.\n', source,
    ]) {
      fs.writeFileSync(translationFile, broken);
      assert.throws(() => compile(root));
    }
    fs.writeFileSync(translationFile, translation);
    content.chapters[0].markdown += '\nChanged source.\n'; fs.writeFileSync(contentFile, JSON.stringify(content));
    assert.throws(() => compile(root), /English source changed/);
    fs.unlinkSync(translationFile);
    content.chapters[0].markdown = source; fs.writeFileSync(contentFile, JSON.stringify(content));
    assert.throws(() => compile(root), /ENOENT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Korean docs preserve complete technical content and reject stale, missing or changed locale sources', async () => {
  const {compile} = await import('../../scripts/compile-docs-locales.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-docs-korean-'));
  const source = '# Backup\n\nKeep the configuration ZIP separately from the service-data Seed. An unavailable backup disk must never become a directory on the system disk.\n\nUse `SEED_DIR` and the [recovery guide](#docs/recovery).\n\n```sh\nrsync --delete "$SOURCE/" "$TARGET/"\n```\n';
  const translated = '# 백업\n\n설정 ZIP은 서비스 데이터 Seed와 별도로 보관하세요. 백업 디스크를 사용할 수 없을 때 시스템 디스크의 디렉터리로 대신 저장해서는 안 됩니다.\n\n`SEED_DIR`와 [복구 안내서](#docs/recovery)를 사용하세요.\n\n```sh\nrsync --delete "$SOURCE/" "$TARGET/"\n```\n';
  const directory = path.join(root, 'src/docs/locales/ko');
  fs.mkdirSync(directory, {recursive:true});
  const filename = path.join(directory, 'backup.md');
  const content = {chapters:[{id:'backup',markdown:source}]};
  const contentFile = path.join(root, 'src/docs/content.json');
  fs.writeFileSync(contentFile, JSON.stringify(content));
  fs.writeFileSync(path.join(directory, 'sources.json'), JSON.stringify({backup:crypto.createHash('sha256').update(source).digest('hex')}));
  try {
    fs.writeFileSync(filename, translated);
    assert.equal(compile(root,'ko').chapters.backup.markdown,translated);
    for (const broken of [translated.replace('--delete','--archive'), translated.replace('`SEED_DIR`','`PERSISTENT_DIR`'),
      translated.replace('#docs/recovery','#docs/storage'), '# 백업\n\n짧은 요약.\n', source]) {
      fs.writeFileSync(filename,broken);
      assert.throws(() => compile(root,'ko'));
    }
    fs.writeFileSync(filename,translated);
    content.chapters[0].markdown += '\nChanged recovery requirement.\n';
    fs.writeFileSync(contentFile,JSON.stringify(content));
    assert.throws(() => compile(root,'ko'),/English source changed/);
    content.chapters[0].markdown = source;fs.writeFileSync(contentFile,JSON.stringify(content));
    fs.unlinkSync(filename);assert.throws(() => compile(root,'ko'),/ENOENT/);
    assert.throws(() => compile(root,'unsupported'),/Unsupported documentation locale/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
