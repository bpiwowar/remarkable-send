// Keeps a copy of the PDF or ePub each tab displays, as the browser loads it
// (webRequest.filterResponseData, Firefox only). It covers what cannot be
// fetched again: POST responses, one-time download links, expired signed URLs.

export type Captured = {
	url: string;
	bytes: Uint8Array;
	contentType: string;
	/** The file name of a Content-Disposition header. */
	fileName?: string;
};

/** Larger documents are not copied (they are fetched again when sent). */
const MAX_BYTES = 200 * 1024 * 1024;

const DOCUMENT_TYPES = new Set(['application/pdf', 'application/x-pdf', 'application/epub+zip']);

// The background page is suspended when idle, so copies are kept in
// IndexedDB (keyed by tab id) rather than in memory.
const STORE = 'byTab';
let database: Promise<IDBDatabase> | undefined;

async function openDatabase(): Promise<IDBDatabase> {
	database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open('captures', 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE);
		};

		request.onsuccess = () => {
			resolve(request.result);
		};

		request.onerror = () => {
			reject(request.error ?? new Error('IndexedDB'));
		};
	});
	return database;
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const request = action(db.transaction(STORE, mode).objectStore(STORE));
		request.onsuccess = () => {
			resolve(request.result);
		};

		request.onerror = () => {
			reject(request.error ?? new Error('IndexedDB'));
		};
	});
}

const captured = {
	async get(tabId: number): Promise<Captured | undefined> {
		return transact('readonly', store => store.get(tabId) as IDBRequest<Captured | undefined>);
	},
	async set(tabId: number, value: Captured): Promise<void> {
		await transact('readwrite', store => store.put(value, tabId));
	},
	async delete(tabId: number): Promise<void> {
		await transact('readwrite', store => store.delete(tabId));
	},
	async clear(): Promise<void> {
		await transact('readwrite', store => store.clear());
	},
};

async function store(tabId: number, value: Captured): Promise<void> {
	try {
		await captured.set(tabId, value);
	} catch (error) {
		console.warn('capture: cannot store', error);
	}
}

function header(headers: browser.webRequest.HttpHeaders | undefined, name: string): string | undefined {
	return headers?.find(h => h.name.toLowerCase() === name)?.value;
}

/** The file name of a Content-Disposition header value. */
export function dispositionFileName(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(value);
	if (star) {
		try {
			return decodeURIComponent(star[2].trim());
		} catch {}
	}

	const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(value);
	return (plain?.[2] ?? plain?.[1])?.trim();
}

function onHeadersReceived(details: browser.webRequest._OnHeadersReceivedDetails): void {
	if (details.tabId < 0 || details.method !== 'GET' && details.method !== 'POST') {
		return;
	}

	const contentType = header(details.responseHeaders, 'content-type')?.split(';')[0].trim().toLowerCase() ?? '';
	if (!DOCUMENT_TYPES.has(contentType)) {
		return;
	}

	const length = Number(header(details.responseHeaders, 'content-length') ?? 0);
	if (length > MAX_BYTES) {
		return;
	}

	const fileName = dispositionFileName(header(details.responseHeaders, 'content-disposition'));
	const filter = browser.webRequest.filterResponseData(details.requestId);
	const chunks: ArrayBuffer[] = [];
	let size = 0;
	filter.ondata = event => {
		filter.write(event.data);
		size += event.data.byteLength;
		if (size <= MAX_BYTES) {
			chunks.push(event.data);
		}
	};

	filter.onstop = () => {
		filter.close();
		if (size > MAX_BYTES) {
			return;
		}

		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(new Uint8Array(chunk), offset);
			offset += chunk.byteLength;
		}

		void store(details.tabId, {
			url: details.url, bytes, contentType, fileName,
		});
	};

	filter.onerror = () => {
		void captured.delete(details.tabId);
	};
}

/** The document captured for a tab, if it is the one at `url`. */
export async function capturedFor(tabId: number, url: string): Promise<Captured | undefined> {
	try {
		const c = await captured.get(tabId);
		return c?.url === url ? c : undefined;
	} catch (error) {
		console.warn('capture: cannot read', error);
		return undefined;
	}
}

export function startCapture(): void {
	browser.webRequest.onHeadersReceived.addListener(
		onHeadersReceived,
		{urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'object']},
		['blocking', 'responseHeaders'],
	);
	browser.tabs.onRemoved.addListener(tabId => {
		void captured.delete(tabId);
	});
	// Tab ids do not survive a restart.
	browser.runtime.onStartup.addListener(() => {
		void captured.clear();
	});
}
