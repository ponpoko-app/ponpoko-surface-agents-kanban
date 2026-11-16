import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(PROJECT, "dist");
const SDK = resolve(PROJECT, "../../ponpoko-surface-sdk");

const problems = [];
const ok = (name) => console.log(`ok   ${name}`);
const bad = (name, detail) => {
	problems.push(`${name}${detail ? ` — ${detail}` : ""}`);
	console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};

const assert = (name, condition, detail = "") => (condition ? ok(name) : bad(name, detail));

async function exists(path) {
	try {
		return await stat(path);
	} catch {
		return null;
	}
}

async function walk(root, current = root, out = []) {
	for (const entry of await readdir(current, { withFileTypes: true })) {
		const path = join(current, entry.name);
		if (entry.isDirectory()) {
			await walk(root, path, out);
			continue;
		}
		out.push({ path, rel: relative(root, path).split("\\").join("/") });
	}
	return out;
}

async function checkInstallable() {
	const manifest = JSON.parse(await readFile(join(PROJECT, "surface.json"), "utf8"));
	const entry = await exists(join(DIST, manifest.entry));
	assert("dist carries the entry document", Boolean(entry), manifest.entry);
	const built = JSON.parse(await readFile(join(DIST, "surface.json"), "utf8"));
	assert("dist surface.json is the source manifest", JSON.stringify(built) === JSON.stringify(manifest));
	const binary = await exists(join(DIST, manifest.backend.command));
	assert("dist carries the backend executable", Boolean(binary?.isFile()), manifest.backend.command);

	const files = await walk(DIST);
	const huge = files.filter((file) => file.rel.endsWith(".js") && file.rel.includes("assets/"));
	const leaking = [];
	for (const file of files) {
		if (!/\.(js|css|html|json)$/.test(file.rel)) continue;
		const body = await readFile(file.path, "utf8");
		if (body.includes(PROJECT)) leaking.push(file.rel);
	}
	assert("no bundle file carries this checkout's path", leaking.length === 0, leaking.join(", "));
	assert("the page ships its own scripts", huge.length > 0);
	assert("surface.json keeps a nav contribution", Array.isArray(manifest.contributes) && manifest.contributes.length === 1);
	assert("every declared method is namespaced", manifest.methods.every((method) => /^[a-z0-9][a-z0-9_]*(\.[a-z0-9][a-z0-9_]*)+$/.test(method)));

	const child = Bun.spawn([join(DIST, manifest.backend.command)], {
		cwd: PROJECT,
		env: { ...process.env, PONPOKO_SURFACE_DATA_DIR: join(DIST, ".smoke-data"), AGENTS_KANBAN_NO_MCP: "1" },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "app.info", params: {} })}\n`);
	child.stdin.flush();
	const reader = child.stdout.getReader();
	const { value } = await reader.read();
	child.kill("SIGTERM");
	await child.exited;
	const line = new TextDecoder().decode(value ?? new Uint8Array()).trim();
	let info = null;
	try {
		info = JSON.parse(line.split("\n")[0]).result;
	} catch {
		info = null;
	}
	assert("the built backend answers app.info", info?.id === "agents-kanban", line.slice(0, 120));
	await rm(join(DIST, ".smoke-data"), { recursive: true, force: true });
}

async function checkSurfaceContract() {
	const scratch = await mkdtemp(join(tmpdir(), "kanban-check-"));
	try {
		const bundle = join(scratch, "bundle");
		await mkdir(join(bundle, "bin"), { recursive: true });
		await cp(join(PROJECT, "surface.json"), join(bundle, "surface.json"));
		await cp(join(DIST, "index.html"), join(bundle, "index.html"));
		await cp(join(PROJECT, "backend"), join(bundle, "backend"), { recursive: true });
		await cp(join(PROJECT, "shared"), join(bundle, "shared"), { recursive: true });
		const launcher = join(bundle, "bin", "agents-kanban-backend");
		await writeFile(launcher, '#!/bin/sh\nexec bun "$(dirname "$0")/../backend/main.ts"\n');
		await chmod(launcher, 0o755);
		const module = await import(pathToFileURL(join(SDK, "scripts", "check-surface.mjs")).href);
		const report = await module.checkSurface(bundle);
		assert("the SDK surface contract accepts the bundle", Boolean(report), JSON.stringify(report ?? {}));
	} catch (error) {
		bad("the SDK surface contract accepts the bundle", String(error));
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

await checkInstallable();
await checkSurfaceContract();

if (problems.length > 0) {
	console.error(`check-bundle: ${problems.length} problem(s)`);
	process.exit(1);
}
console.log("check-bundle: the installable bundle and the surface contract both hold");
