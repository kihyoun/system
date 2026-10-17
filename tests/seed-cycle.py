from pathlib import Path
import subprocess
import tempfile

repository = Path(__file__).resolve().parents[1]

with tempfile.TemporaryDirectory(prefix='system-seed-test-') as temporary:
    root = Path(temporary)
    for name in ('seed', 'srv', 'ssl', 'empty'):
        (root / name).mkdir()
    (root / 'srv' / 'generation').write_text('generation A data')
    (root / 'ssl' / 'certificate').write_text('test certificate')

    def run(script, seed='seed'):
        return subprocess.run([
            'docker', 'run', '--rm', '--entrypoint', 'bash',
            '-v', f'{repository / "system"}:/scripts:ro',
            '-v', f'{root / seed}:/seed',
            '-v', f'{root / "srv"}:/srv',
            '-v', f'{root / "ssl"}:/ssl',
            'system_bootstrapper', f'/scripts/{script}.sh',
        ], capture_output=True, text=True)

    result = run('harvest')
    assert result.returncode == 0, result.stderr
    assert (root / 'seed' / 'srv' / 'generation').read_text() == 'generation A data'
    assert (root / 'seed' / 'ssl' / 'certificate').read_text() == 'test certificate'
    (root / 'srv' / 'generation').write_text('changed')
    (root / 'srv' / 'extra').write_text('remove during restore')
    (root / 'ssl' / 'certificate').unlink()
    result = run('seed')
    assert result.returncode == 0, result.stderr
    assert (root / 'srv' / 'generation').read_text() == 'generation A data'
    assert not (root / 'srv' / 'extra').exists()
    assert (root / 'ssl' / 'certificate').read_text() == 'test certificate'
    print('PASS: harvest -> seed restores test data and removes stale files')
    result = run('seed', 'empty')
    assert result.returncode == 0, result.stderr
    assert (root / 'srv' / 'generation').read_text() == 'generation A data'
    print('PASS: absent seed succeeds without changing destination')
    (root / 'empty' / 'srv').mkdir()
    (root / 'empty' / 'srv' / 'generation').write_text('incomplete seed data')
    result = run('seed', 'empty')
    assert result.returncode != 0, 'BUG: incomplete seed reported success'
    assert (root / 'srv' / 'generation').read_text() == 'generation A data'
    print('PASS: incomplete seed rejected before changing destination')
