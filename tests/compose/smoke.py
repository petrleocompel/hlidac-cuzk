"""Opt-in real Compose installation checks; uses only disposable hlidac_test_* stacks.
Run: python3 tests/compose/smoke.py <locally-built-app-image>
Requires Docker, Compose and cached postgres:16-alpine/caddy:2-alpine images.
"""
import json
import os
import pathlib
import shutil
import ssl
import subprocess
import sys
import tempfile
import urllib.request
import uuid

image = sys.argv[1]
root = pathlib.Path(__file__).resolve().parents[2]


def command(args, cwd=None):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


for scenario in (sys.argv[2:] or ['loopback', 'lan', 'proxy', 'external']):
    project = 'hlidac_test_compose_' + uuid.uuid4().hex[:10]
    network = project + '_external'
    external = project + '_postgres'
    with tempfile.TemporaryDirectory(prefix=project) as directory:
        directory = pathlib.Path(directory)
        for name in ['docker-compose.yml', 'docker-compose.selfhost.yml', 'docker-compose.external.yml', 'docker-compose.proxy.yml', 'Caddyfile']:
            shutil.copy(root / 'deploy' / name, directory / name)
        # Explicit fixtures only. Never read an operator's .env.
        (directory / '.env').write_text('\n'.join([
            'HLIDAC_CUZK_IMAGE=' + image,
            'POSTGRES_USER=postgres', 'POSTGRES_PASSWORD=compose-fixture-only',
            'POSTGRES_DB=hlidac_test_compose',
            'DATABASE_URL=postgres://postgres:compose-fixture-only@' + (external if scenario == 'external' else 'db') + ':5432/hlidac_test_compose',
            'BETTER_AUTH_SECRET=compose-fixture-auth-secret-at-least-32-characters',
            'NOTIFICATION_ENCRYPTION_KEY=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
            'PUBLIC_URL=https://localhost', 'APP_HOST=localhost',
            'ADMIN_EMAIL=compose@example.test', 'ADMIN_PASSWORD=compose-fixture-admin-password',
            'CUZK_API_KEY=compose-fixture-only', 'CUZK_API_BASE_URL=http://127.0.0.1:1',
            'SSO_BOOTSTRAP_ENABLED=false', 'SEED_DEMO_WATCH=0', 'SENTRY_DSN=',
            'APP_HOST_PORT=0', 'HTTPS_PORT=0', 'HTTP_PORT=0',
            'PROXY_BIND_ADDRESS=127.0.0.1',
        ]) + ('\nAPP_BIND_ADDRESS=0.0.0.0\n' if scenario == 'lan' else '\n'))
        (directory / '.env').chmod(0o600)
        files = ['docker-compose.external.yml' if scenario == 'external' else 'docker-compose.yml',
                 'docker-compose.proxy.yml' if scenario == 'proxy' else 'docker-compose.selfhost.yml']
        base = ['docker', 'compose', '-p', project]
        try:
            if scenario == 'external':
                command(['docker', 'network', 'create', network])
                command(['docker', 'run', '-d', '--name', external, '--network', network,
                         '-e', 'POSTGRES_PASSWORD=compose-fixture-only', '-e', 'POSTGRES_DB=hlidac_test_compose',
                         '--health-cmd', 'pg_isready -U postgres', '--health-interval', '1s', '--health-retries', '30',
                         'postgres:16-alpine'])
                import time
                for _ in range(60):
                    if command(['docker', 'inspect', '--format', '{{.State.Health.Status}}', external]) == 'healthy':
                        break
                    time.sleep(1)
                else:
                    raise AssertionError('external database did not become healthy')
                (directory / 'network.yml').write_text('networks:\n  default:\n    external: true\n    name: ' + network + '\n')
                files.append('network.yml')
            for name in files:
                base += ['-f', name]
            def compose(*args):
                return command(base + list(args), directory)
            config = json.loads(compose('config', '--format', 'json'))
            if scenario == 'external':
                assert 'db' not in config['services']
                assert not config.get('volumes')
                assert all('db' not in service.get('depends_on', {}) for service in config['services'].values())
            elif scenario == 'proxy':
                assert not config['services']['app'].get('ports')
            else:
                assert config['services']['app']['ports'][0]['host_ip'] == ('0.0.0.0' if scenario == 'lan' else '127.0.0.1')
            compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120')
            service, port = ('proxy', '443') if scenario == 'proxy' else ('app', '3000')
            address = compose('port', service, port).splitlines()[0]
            port = address.rsplit(':', 1)[1]
            # Internal fixture CA only: do not use this TLS bypass outside this test.
            context = ssl._create_unverified_context() if scenario == 'proxy' else None
            url = ('https' if scenario == 'proxy' else 'http') + '://localhost:' + port
            if os.environ.get('COMPOSE_SMOKE_IN_CONTAINER') == '1':
                # Docker-in-Docker publishes on its own host, not the CI job container.
                compose('exec', '-T', 'app', 'node', '--input-type=module', '-e', "for(const p of ['/readyz','/login']) { const r=await fetch('http://127.0.0.1:3000'+p); if(r.status!==200)process.exit(1); }")
            else:
                for path in ['/readyz', '/login']:
                    with urllib.request.urlopen(url + path, context=context, timeout=10) as response:
                        assert response.status == 200
            # Runtime identity/filesystem checks apply to the released app image.
            assert compose('exec', '-T', 'app', 'id', '-u') == '1000'
            assert config['services']['app']['read_only'] is True
            compose('exec', '-T', 'app', 'sh', '-ec', 'test ! -w /app; test -w /tmp')
            compose('exec', '-T', 'app', 'sh', '-ec', 'test ! -e node_modules/vitest; test ! -e node_modules/eslint; test ! -e node_modules/typescript')
            result = compose('exec', '-T', 'app', 'pnpm', 'run', 'doctor')
            assert 'OK schéma' in result
            assert 'OK správce' in result
            # Ensure the bootstrap did not seed watches or make API requests.
            check = "import postgres from 'postgres'; const c=postgres(process.env.DATABASE_URL); for(const t of ['parcel_watches','cuzk_api_requests']) { const r=await c.unsafe('select count(*)::int n from '+t); if(r[0].n!==0)process.exitCode=1; } await c.end();"
            compose('exec', '-T', 'app', 'node', '--input-type=module', '-e', check)
            # Exercise SIGTERM and restart with the same durable DB state.
            compose('stop', '-t', '15', 'cron')
            # Compose versions serialize either one JSON array or newline objects;
            # inspect directly to keep the exit-code check stable.
            cron_id = compose('ps', '--all', '-q', 'cron')
            assert command(['docker', 'inspect', '--format', '{{.State.ExitCode}}', cron_id]) == '0'
            compose('up', '-d', '--no-deps', 'cron')
            print('PASS clean installation, readiness, login page, admin and no CUZK calls:', scenario, flush=True)
        except subprocess.CalledProcessError as error:
            # No rendered env or database URL in diagnostics.
            print('FAIL Compose command exit:', error.returncode, 'scenario:', scenario, file=sys.stderr)
            print(error.stderr, file=sys.stderr)
            logs = subprocess.run(base + ['logs', '--tail', '30', 'migrate', 'app'], cwd=directory, capture_output=True, text=True)
            print(logs.stdout, file=sys.stderr)
            raise SystemExit(1) from None
        finally:
            subprocess.run(base + ['down', '--volumes', '--remove-orphans'], cwd=directory, capture_output=True)
            if scenario == 'external':
                subprocess.run(['docker', 'rm', '-f', external], capture_output=True)
                subprocess.run(['docker', 'network', 'rm', network], capture_output=True)
