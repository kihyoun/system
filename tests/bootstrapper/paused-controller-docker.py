#!/usr/bin/env python3
"""Explicit tiny local-Docker acceptance of the cold control-plane stop primitive."""
import argparse
import json
import os
import subprocess
import time
import uuid

IMAGE = 'node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f'
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']


def command(args):
    return subprocess.check_output([*DOCKER, *args], stderr=subprocess.PIPE, timeout=45)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-local-daemon', action='store_true', required=True,
                        help='Explicitly permit one labeled disposable container on the local Docker socket.')
    parser.parse_args()
    operation = uuid.uuid4().hex
    name = 'system-paused-controller-test-' + operation
    owned = False
    try:
        # Do not silently pull a different or moving test base.
        command(['image', 'inspect', IMAGE])
        command(['run', '-d', '--name', name, '--label', 'org.system-bootstrapper.pause-test=' + operation,
                 '--network', 'none', '--read-only', '--memory', '64m', '--cpus', '0.1', '--pids-limit', '16',
                 '--restart', 'always', '--entrypoint', '/bin/sh', IMAGE,
                 '-c', 'while :; do printf "heartbeat\\n"; sleep 0.05; done'])
        owned = True
        time.sleep(0.3)
        before = json.loads(command(['inspect', name]))[0]
        assert before['HostConfig']['RestartPolicy']['Name'] == 'always'
        assert before['State']['Running']
        assert command(['logs', name])
        command(['update', '--restart=no', name])
        command(['pause', name])
        frozen = json.loads(command(['inspect', name]))[0]
        assert frozen['State']['Paused'] and frozen['State']['Running']
        heartbeat = command(['logs', name])
        time.sleep(0.3)
        assert command(['logs', name]) == heartbeat
        # SIGKILL is delivered to the frozen process before any daemon thaw.
        # Never explicitly unpause the old controller and allow old code to run.
        command(['kill', name])
        stopped = json.loads(command(['inspect', name]))[0]
        assert not stopped['State']['Running'] and not stopped['State']['Paused']
        assert stopped['State']['ExitCode'] == 137 and not stopped['State']['OOMKilled']
        assert stopped['HostConfig']['RestartPolicy']['Name'] == 'no'
        assert stopped.get('ExecIDs') in (None, [])
        time.sleep(0.5)
        final = json.loads(command(['inspect', name]))[0]
        assert not final['State']['Running'] and final['RestartCount'] == before['RestartCount']
        assert command(['logs', name]) == heartbeat
        print(json.dumps({'passed': True, 'engine': command(['version', '--format', '{{.Server.Version}}']).decode().strip(),
                          'pausedHeartbeatFrozen': True, 'killedWithoutExplicitUnpause': True,
                          'restartPolicyDisabled': True, 'oldCodeDidNotResumeOrRestart': True}))
    finally:
        if owned:
            current = json.loads(command(['inspect', name]))[0]
            if current['Config']['Labels'].get('org.system-bootstrapper.pause-test') != operation:
                raise RuntimeError('Refusing to clean a container with changed ownership.')
            command(['rm', '--force', name])


if __name__ == '__main__':
    main()
