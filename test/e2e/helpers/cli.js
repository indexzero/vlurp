import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { spawn as spawnPty } from 'node-pty';

const helperDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(helperDir, '..', '..', '..');
export const binPath = join(repoRoot, 'bin', 'vlurp');

export function normalizeTerminalOutput(output) {
  return stripVTControlCharacters(output).replaceAll('\r', '\n');
}

export function runCommand(command, args, { cwd, env = {}, timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CI: '1',
        NO_COLOR: '1',
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(`${command} timed out after ${timeout}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`)
      );
    }, timeout);

    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

export function runVlurp(args, { executable = binPath, ...options } = {}) {
  return runCommand(process.execPath, [executable, ...args], options);
}

export function runVlurpInPty(args, { cwd, cols = 100, rows = 30, executable = binPath } = {}) {
  const terminal = spawnPty(process.execPath, [executable, ...args], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1'
    }
  });

  let transcript = '';
  const textWaiters = new Set();
  terminal.onData(data => {
    transcript += data;

    for (const waiter of textWaiters) {
      if (normalizeTerminalOutput(transcript).includes(waiter.text)) {
        clearTimeout(waiter.timer);
        textWaiters.delete(waiter);
        waiter.resolve();
      }
    }
  });

  const exited = new Promise(resolve => {
    terminal.onExit(event => {
      for (const waiter of textWaiters) {
        clearTimeout(waiter.timer);
        textWaiters.delete(waiter);
        waiter.reject(
          new Error(
            `vlurp exited before ${JSON.stringify(waiter.text)} appeared\nterminal transcript:\n${transcript}`
          )
        );
      }

      resolve(event);
    });
  });

  return {
    get transcript() {
      return transcript;
    },
    get output() {
      return normalizeTerminalOutput(transcript);
    },
    write(data) {
      terminal.write(data);
    },
    waitForText(text, { timeout = 10_000 } = {}) {
      if (normalizeTerminalOutput(transcript).includes(text)) {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        const waiter = { text, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          textWaiters.delete(waiter);
          terminal.kill('SIGKILL');
          reject(
            new Error(
              `Timed out waiting for ${JSON.stringify(text)}\nterminal transcript:\n${transcript}`
            )
          );
        }, timeout);
        textWaiters.add(waiter);
      });
    },
    async waitForExit({ timeout = 10_000 } = {}) {
      let timer;

      try {
        return await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              terminal.kill('SIGKILL');
              reject(new Error(`vlurp did not exit\nterminal transcript:\n${transcript}`));
            }, timeout);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
