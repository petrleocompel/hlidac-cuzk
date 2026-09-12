import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
/** Native executables with structured argv; no shell, raw stderr or credential arguments. */
export async function backupCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const result = await execute(command, args, {
      env,
      timeout: 90 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
      killSignal: 'SIGTERM',
    })
    return result.stdout
  } catch {
    throw new Error(
      `Příkaz ${command} selhal. Ověřte dostupnost, oprávnění, heslo úložiště a volné místo.`,
    )
  }
}
