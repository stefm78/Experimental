from __future__ import annotations
import json, os, platform, shutil, subprocess
from pathlib import Path

def _run(argv):
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=15, check=False)
        t = (p.stdout + ('\n' if p.stdout and p.stderr else '') + p.stderr).strip()
        return {'returncode': p.returncode, 'output': t or 'unknown'}
    except Exception as exc:
        return {'returncode': None, 'output': f'unavailable:{type(exc).__name__}'}

def _cpu():
    p = Path('/proc/cpuinfo')
    if p.exists():
        for line in p.read_text(errors='replace').splitlines():
            if line.lower().startswith('model name') and ':' in line:
                return line.split(':', 1)[1].strip()
    return platform.processor() or 'unknown'

def _ram():
    p = Path('/proc/meminfo')
    if p.exists():
        for line in p.read_text(errors='replace').splitlines():
            if line.startswith('MemTotal:'):
                return line.split(':', 1)[1].strip()
    return 'unknown'

def snapshot():
    pv = Path('/proc/version').read_text(errors='replace') if Path('/proc/version').exists() else ''
    wsl = 'microsoft' in pv.lower() or bool(os.getenv('WSL_DISTRO_NAME'))
    server = os.getenv('LLAMA_SERVER_BIN', 'llama-server')
    bench = os.getenv('LLAMA_BENCH_BIN', 'llama-bench')
    return {'snapshot_version': 'local-llm-lab.system.v1', 'os': platform.platform(), 'kernel': platform.release(), 'machine': platform.machine(), 'wsl_detected': wsl, 'wsl_distro': os.getenv('WSL_DISTRO_NAME') if wsl else None, 'cpu_model': _cpu(), 'logical_cpu_count': os.cpu_count(), 'ram_total': _ram(), 'gpu_probe': _run(['nvidia-smi', '--query-gpu=name,driver_version,memory.total', '--format=csv,noheader']) if shutil.which('nvidia-smi') else {'returncode': None, 'output': 'unknown'}, 'pci_probe': _run(['lspci']) if shutil.which('lspci') else {'returncode': None, 'output': 'unknown'}, 'llama_devices': _run([server, '--list-devices']) if shutil.which(server) else {'returncode': None, 'output': 'unavailable'}, 'llama_server_version': _run([server, '--version']) if shutil.which(server) else {'returncode': None, 'output': 'unavailable'}, 'llama_bench_version': _run([bench, '--version']) if shutil.which(bench) else {'returncode': None, 'output': 'unavailable'}}

def main():
    print(json.dumps(snapshot(), ensure_ascii=False, indent=2, sort_keys=True))
if __name__ == '__main__':
    main()
