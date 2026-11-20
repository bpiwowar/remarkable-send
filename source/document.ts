// What to send for a tab or a link: the PDF or ePub itself, or the page's
// article as an ePub.
import {articleEpub} from './article.js';
import {capturedFor, dispositionFileName} from './capture.js';
import type {Upload} from './cloud.js';

export class SendError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SendError';
	}
}

const decoder = new TextDecoder('latin1');

/** The kind of a file, from its first bytes. */
export function sniff(bytes: Uint8Array): 'pdf' | 'epub' | undefined {
	const head = decoder.decode(bytes.subarray(0, 1024));
	if (head.includes('%PDF-')) {
		return 'pdf';
	}

	// EPUB: a zip whose first entry is "mimetype", stored, with this content.
	if (head.startsWith('PK\u0003\u0004') && head.slice(30, 58) === 'mimetypeapplication/epub+zip') {
		return 'epub';
	}

	return undefined;
}

/** A document name from a title or file name: no extension, no blank. */
function documentName(...candidates: Array<string | undefined>): string {
	for (const candidate of candidates) {
		const name = candidate?.trim().replace(/\.(pdf|epub)$/i, '').trim();
		if (name) {
			return name;
		}
	}

	return 'Untitled';
}

function fileNameOf(url: string): string | undefined {
	try {
		const last = new URL(url).pathname.split('/').pop();
		return last ? decodeURIComponent(last) : undefined;
	} catch {
		return undefined;
	}
}

/** A title that is not just the URL or the file name (Firefox shows those when there is none). */
function realTitle(title: string | undefined, url: string): string | undefined {
	return title && title !== url && title !== fileNameOf(url) ? title : undefined;
}

type Fetched = {bytes: Uint8Array; contentType: string; fileName?: string; url: string};

async function fetchDocument(url: string): Promise<Fetched> {
	let response: Response;
	try {
		response = await fetch(url, {credentials: 'include', cache: 'force-cache'});
	} catch (error) {
		throw new SendError(`Cannot download ${url}: ${String(error)}`);
	}

	if (!response.ok) {
		throw new SendError(`Cannot download ${url}: ${response.status} ${response.statusText}`);
	}

	return {
		bytes: new Uint8Array(await response.arrayBuffer()),
		contentType: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '',
		fileName: dispositionFileName(response.headers.get('content-disposition') ?? undefined),
		url: response.url || url,
	};
}

function isHtml(contentType: string): boolean {
	return contentType === 'text/html' || contentType === 'application/xhtml+xml';
}

async function fromBytes(fetched: Fetched, title: string | undefined, images: boolean): Promise<Upload> {
	const kind = sniff(fetched.bytes);
	if (kind) {
		return {kind, name: documentName(title, fetched.fileName, fileNameOf(fetched.url)), bytes: fetched.bytes};
	}

	if (isHtml(fetched.contentType)) {
		const article = await articleEpub(new TextDecoder().decode(fetched.bytes), fetched.url, images);
		return {kind: 'epub', name: documentName(title, article.title), bytes: article.epub};
	}

	throw new SendError(`Not a PDF, an ePub or a web page (${fetched.contentType || 'unknown type'}).`);
}

type PageSnapshot = {contentType: string; html: string};

/** The page's DOM as it is now (with what scripts and the user did to it). */
async function snapshot(tabId: number): Promise<PageSnapshot | undefined> {
	try {
		const [result] = await browser.scripting.executeScript({
			target: {tabId},
			func: () => ({contentType: document.contentType, html: document.documentElement.outerHTML}),
		});
		return result?.result;
	} catch {
		// Privileged pages (the PDF viewer, about:, the add-on store) refuse scripts.
		return undefined;
	}
}

/** What to send for a tab. `name` overrides the document name. */
export async function fromTab(tab: browser.tabs.Tab, name: string | undefined, images: boolean): Promise<Upload> {
	const url = tab.url ?? '';
	if (!/^https?:/.test(url)) {
		throw new SendError('Only web pages (http or https) can be sent.');
	}

	const title = name || realTitle(tab.title, url);

	// The bytes the browser loaded, if they were captured.
	const captured = await capturedFor(tab.id!, url);
	if (captured) {
		const kind = sniff(captured.bytes);
		if (kind) {
			return {kind, name: documentName(title, captured.fileName, fileNameOf(url)), bytes: captured.bytes};
		}
	}

	const page = await snapshot(tab.id!);
	if (page && isHtml(page.contentType)) {
		const article = await articleEpub(page.html, url, images);
		return {kind: 'epub', name: documentName(name, article.title, title), bytes: article.epub};
	}

	return fromBytes(await fetchDocument(url), title, images);
}

/** What to send for a link. */
export async function fromLink(url: string, linkText: string | undefined, images: boolean): Promise<Upload> {
	if (!/^https?:/.test(url)) {
		throw new SendError('Only http or https links can be sent.');
	}

	const fetched = await fetchDocument(url);
	const kind = sniff(fetched.bytes);
	if (kind) {
		// Link texts are often "PDF" or "Download": prefer the server's file name.
		const text = linkText && linkText.length > 12 && !/^\W*(pdf|epub|download|full text)\b/i.test(linkText) ? linkText : undefined;
		return {kind, name: documentName(fetched.fileName, text, fileNameOf(fetched.url)), bytes: fetched.bytes};
	}

	return fromBytes(fetched, undefined, images);
}
