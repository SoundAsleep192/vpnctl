export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Exec = (cmd: string, args: string[]) => Promise<ExecResult>;

export const realExec: Exec = async (cmd, args) => {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, exitCode };
};
