export interface CheckResult {
	command: string;
	exit: number;
	timedOut: boolean;
	output: string;
}

export function normalizeChecks(input: unknown): string[] {
	if (!Array.isArray(input) || input.some((item) => typeof item !== "string" || !item.trim())) {
		throw new Error("คำสั่งตรวจต้องเป็นรายการข้อความที่ไม่ว่าง");
	}
	return input.map((command: string) => command.trim());
}

const OUTPUT_LIMIT = 3500;
const CHECK_TIMEOUT_MS = 120_000;

async function collect(stream: ReadableStream<Uint8Array>, append: (text: string) => void): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			append(decoder.decode(value, { stream: true }));
		}
		append(decoder.decode());
	} finally {
		reader.releaseLock();
	}
}

function killGroup(pid: number): void {
	try { process.kill(-pid, "SIGKILL"); } catch {}
}

export class CheckRunner {
	private readonly active = new Set<number>();

	async run(directory: string, commands: readonly string[], started: (pid: number) => void, timeout = CHECK_TIMEOUT_MS): Promise<CheckResult[]> {
		const results: CheckResult[] = [];
		for (const command of commands) {
			const result = await this.one(directory, command, started, timeout);
			results.push(result);
			if (result.exit !== 0 || result.timedOut) break;
		}
		return results;
	}

	stop(): void {
		for (const pid of this.active) killGroup(pid);
	}

	private async one(cwd: string, command: string, started: (pid: number) => void, timeout: number): Promise<CheckResult> {
		const proc = Bun.spawn(["/bin/sh", "-c", command], { cwd, stdout: "pipe", stderr: "pipe", detached: true });
		this.active.add(proc.pid);
		let output = "";
		let timedOut = false;
		const append = (text: string): void => { output = (output + text).slice(-OUTPUT_LIMIT); };
		const timer = setTimeout(() => {
			timedOut = true;
			killGroup(proc.pid);
		}, timeout);
		try {
			started(proc.pid);
			const streams = Promise.all([collect(proc.stdout, append), collect(proc.stderr, append)]);
			const exit = await proc.exited;
			killGroup(proc.pid);
			await streams;
			return { command, exit, timedOut, output: output.trim() };
		} finally {
			clearTimeout(timer);
			if (proc.exitCode === null) killGroup(proc.pid);
			this.active.delete(proc.pid);
		}
	}
}
