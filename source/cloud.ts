// The reMarkable cloud, through remarkable-annotations' sans-I/O client
// (WebAssembly): the library decides which requests to make, this module makes
// them with fetch (a batch's items concurrently) and waits between retries.
import init, * as wasm from 'remarkable-annotations';
import wasmUrl from 'url:remarkable-annotations/remarkable_annotations_wasm_bg.wasm';
import {getSettings, setSettings} from './settings.js';

type Request = {
	type: 'request';
	method: string;
	url: string;
	headers: Array<[string, string]>;
	body?: Uint8Array;
};
type Sleep = {type: 'sleep'; ms: number};
type Response = {status: number; statusText: string; body: Uint8Array} | {networkError: string};
type CloudErrorValue = {kind: string; message: string; status?: number};
type Done = {type: 'done'; json?: string; bytes?: Uint8Array; text?: string};
type Step =
	| Request
	| Sleep
	| {type: 'batch'; items: Array<Request | Sleep>}
	| Done
	| {type: 'error'; error: CloudErrorValue};

/** At most this many requests of a batch in flight. */
const MAX_IN_FLIGHT = 6;

export class CloudError extends Error {
	readonly kind: string;
	readonly status?: number;

	constructor(error: CloudErrorValue) {
		super(error.message);
		this.name = 'CloudError';
		this.kind = error.kind;
		this.status = error.status;
	}
}

let ready: Promise<unknown> | undefined;

async function loadWasm(): Promise<void> {
	ready ??= init({module_or_path: wasmUrl});
	await ready;
}

async function perform(item: Request | Sleep): Promise<Response | undefined> {
	if (item.type === 'sleep') {
		await new Promise(resolve => {
			setTimeout(resolve, Math.random() * item.ms);
		});
		return undefined;
	}

	try {
		const r = await fetch(item.url, {
			method: item.method,
			headers: item.headers,
			body: item.body as BodyInit | undefined,
			credentials: 'omit',
		});
		return {status: r.status, statusText: r.statusText, body: new Uint8Array(await r.arrayBuffer())};
	} catch (error) {
		return {networkError: String(error)};
	}
}

async function performAll(items: Array<Request | Sleep>): Promise<Array<Response | undefined>> {
	const out: Array<Response | undefined> = Array.from({length: items.length});
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await perform(items[i]);
		}
	};

	await Promise.all(Array.from({length: Math.min(MAX_IN_FLIGHT, items.length)}, worker));
	return out;
}

/** Runs an operation to its end. */
async function run(op: wasm.CloudOperation): Promise<Done> {
	try {
		let step = op.start() as Step;
		for (;;) {
			switch (step.type) {
				case 'batch': {
					step = op.resumeBatch(await performAll(step.items)) as Step;
					break;
				}

				case 'request':
				case 'sleep': {
					step = op.resume(await perform(step)) as Step;
					break;
				}

				case 'done': {
					return step;
				}

				case 'error': {
					throw new CloudError(step.error);
				}

				default: {
					throw new CloudError({kind: 'unexpected', message: `unexpected step ${JSON.stringify(step)}`});
				}
			}
		}
	} finally {
		op.free();
	}
}

/** Exchanges a one-time code (my.remarkable.com) for a device token, and stores it. */
export async function register(code: string): Promise<void> {
	await loadWasm();
	const done = await run(wasm.cloudRegister(code.trim(), 'browser-chrome', crypto.randomUUID()));
	if (!done.text) {
		throw new CloudError({kind: 'register', message: 'no device token in the response'});
	}

	await setSettings({deviceToken: done.text});
	session = undefined;
}

let session: {session: wasm.CloudSession; at: number} | undefined;

/** Session tokens are short-lived: get a new one after this long. */
const SESSION_TTL = 60 * 60 * 1000;

async function getSession(): Promise<wasm.CloudSession> {
	await loadWasm();
	if (session && Date.now() - session.at < SESSION_TTL) {
		return session.session;
	}

	const {deviceToken} = await getSettings();
	if (!deviceToken) {
		throw new CloudError({kind: 'signedOut', message: 'Not connected to reMarkable: open the extension options to connect.'});
	}

	const done = await run(wasm.cloudAuth(deviceToken));
	session?.session.free();
	session = {session: new wasm.CloudSession(done.text!), at: Date.now()};
	return session.session;
}

export function forgetSession(): void {
	session?.session.free();
	session = undefined;
}

export type Upload = {
	kind: 'pdf' | 'epub';
	name: string;
	bytes: Uint8Array;
};

/** Uploads a document into the folder `folder` (a path such as "Web/Articles"; empty for the root). */
export async function upload({kind, name, bytes}: Upload, folder: string, retried = false): Promise<void> {
	const s = await getSession();
	const parts = folder.split('/').filter(p => p.trim());
	const parent = parts.length > 0
		? JSON.parse((await run(s.ensureFolder(folder, parts.map(() => crypto.randomUUID()), Date.now()))).json!) as string
		: '';
	const options = JSON.stringify({parent});
	const op = kind === 'pdf'
		? s.putPdf(name, bytes, options, crypto.randomUUID(), crypto.randomUUID(), Date.now())
		: s.putEpub(name, bytes, options, crypto.randomUUID(), crypto.randomUUID(), Date.now());
	try {
		await run(op);
	} catch (error) {
		// An expired or revoked session: authenticate again once.
		if (!retried && error instanceof CloudError && error.status === 401) {
			forgetSession();
			return upload({kind, name, bytes}, folder, true);
		}

		throw error;
	}
}
