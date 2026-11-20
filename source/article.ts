// Web page -> ePub: Readability extracts the article, its images are fetched
// and embedded, and the result is written as an EPUB 3.
import {Readability} from '@mozilla/readability';
import {buildEpub, type EpubImage} from './epub.js';

const MAX_IMAGES = 80;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;

/** Image types kept as they are; others (WebP, AVIF…) are converted to JPEG. */
const IMAGE_EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
};

const REMOVED = 'script, style, link, meta, iframe, frame, object, embed, form, input, button, select, textarea, noscript, template, canvas, video, audio, source, track, map, area, dialog';

/** XML-safe attribute names (HTML allows more). */
const ATTRIBUTE = /^[a-zA-Z_][\w.-]*$/;
const DROPPED_ATTRIBUTES = new Set(['srcset', 'sizes', 'loading', 'decoding', 'fetchpriority', 'style', 'class', 'id', 'tabindex', 'contenteditable', 'draggable', 'role']);

export type Article = {
	title: string;
	epub: Uint8Array;
};

type ImageResult = {mediaType: string; bytes: Uint8Array} | undefined;

async function fetchImage(url: string): Promise<ImageResult> {
	const response = await fetch(url, {credentials: 'include', cache: 'force-cache'});
	if (!response.ok) {
		return undefined;
	}

	const blob = await response.blob();
	if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES) {
		return undefined;
	}

	const type = blob.type.split(';')[0].trim().toLowerCase();
	if (type in IMAGE_EXTENSIONS) {
		return {mediaType: type, bytes: new Uint8Array(await blob.arrayBuffer())};
	}

	// Anything else the browser can decode: re-encode as JPEG.
	const bitmap = await createImageBitmap(blob);
	try {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#fff';
		context.fillRect(0, 0, bitmap.width, bitmap.height);
		context.drawImage(bitmap, 0, 0);
		const jpeg = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.85});
		return {mediaType: 'image/jpeg', bytes: new Uint8Array(await jpeg.arrayBuffer())};
	} finally {
		bitmap.close();
	}
}

/** Embeds the images of `root` (or removes them), returning the EPUB entries. */
async function embedImages(root: Element, include: boolean): Promise<EpubImage[]> {
	const images: EpubImage[] = [];
	const imgs = [...root.querySelectorAll('img')];
	const byUrl = new Map<string, Promise<EpubImage | undefined>>();
	let total = 0;

	const load = async (url: string): Promise<EpubImage | undefined> => {
		try {
			const result = await fetchImage(url);
			if (!result || total + result.bytes.byteLength > MAX_TOTAL_IMAGE_BYTES) {
				return undefined;
			}

			total += result.bytes.byteLength;
			const image = {path: `images/${images.length + 1}.${IMAGE_EXTENSIONS[result.mediaType]}`, ...result};
			images.push(image);
			return image;
		} catch (error) {
			console.warn('article: cannot fetch image', url, error);
			return undefined;
		}
	};

	await Promise.all(imgs.map(async (img, i) => {
		const src = img.getAttribute('src')?.trim() ?? '';
		let url: URL | undefined;
		try {
			// An empty src would resolve to the page itself.
			url = src ? new URL(src, root.ownerDocument.baseURI) : undefined;
		} catch {}

		if (!include || i >= MAX_IMAGES || !url || !/^(https?|data):$/.test(url.protocol)) {
			img.remove();
			return;
		}

		let pending = byUrl.get(url.href);
		if (!pending) {
			pending = load(url.href);
			byUrl.set(url.href, pending);
		}

		const image = await pending;
		if (image) {
			img.setAttribute('src', image.path);
			img.setAttribute('alt', img.getAttribute('alt') ?? '');
		} else {
			img.remove();
		}
	}));
	return images;
}

/** Widest image wanted from a srcset (pixels). */
const PREFERRED_WIDTH = 1600;

/** The best candidate of a srcset: the widest up to PREFERRED_WIDTH (else the narrowest), or the densest. */
export function pickSrcset(srcset: string): string | undefined {
	const candidates = srcset.split(/,\s+/).map(item => {
		const [url, descriptor = '1x'] = item.trim().split(/\s+/);
		const value = Number.parseFloat(descriptor);
		// Density descriptors: 1x as a 800 pixels wide image.
		const width = descriptor.endsWith('w') ? value : value * 800;
		return {url, width: Number.isFinite(width) ? width : 0};
	}).filter(c => c.url);
	const fitting = candidates.filter(c => c.width <= PREFERRED_WIDTH).sort((a, b) => b.width - a.width);
	const rest = candidates.filter(c => c.width > PREFERRED_WIDTH).sort((a, b) => a.width - b.width);
	return (fitting[0] ?? rest[0])?.url;
}

/** Images with no src (lazy loading, <picture>): take one from a srcset. */
function resolveSources(root: Element): void {
	for (const img of root.querySelectorAll('img')) {
		if (img.getAttribute('src')?.trim()) {
			continue;
		}

		const srcsets = [img.getAttribute('srcset'), ...Array.from(
			img.closest('picture')?.querySelectorAll('source') ?? [],
			source => source.getAttribute('srcset'),
		)];
		const src = srcsets.map(srcset => (srcset ? pickSrcset(srcset) : undefined)).find(Boolean);
		if (src) {
			img.setAttribute('src', src);
		}
	}
}

/** Makes the article's DOM fit in an EPUB chapter. */
function clean(root: Element): void {
	resolveSources(root);
	for (const element of root.querySelectorAll(REMOVED)) {
		element.remove();
	}

	// <picture>: keep its <img>.
	for (const picture of root.querySelectorAll('picture')) {
		const img = picture.querySelector('img');
		if (img) {
			picture.replaceWith(img);
		} else {
			picture.remove();
		}
	}

	for (const element of root.querySelectorAll('*')) {
		for (const {name} of Array.from(element.attributes)) { // A copy: attributes are removed
			if (!ATTRIBUTE.test(name) || name.startsWith('on') || name.startsWith('data-') || DROPPED_ATTRIBUTES.has(name)) {
				element.removeAttribute(name);
			}
		}

		// Links to the page itself, or scripts: no target in the EPUB.
		if (element.localName === 'a') {
			const href = element.getAttribute('href') ?? '';
			if (href.startsWith('#') || /^javascript:/i.test(href)) {
				element.removeAttribute('href');
			}
		}
	}
}

function serialize(root: Element): string {
	const serializer = new XMLSerializer();
	return [...root.childNodes].map(node => serializer.serializeToString(node)).join('');
}

/** Extracts the article of a page (`html` as loaded from `url`) as an ePub. */
export async function articleEpub(html: string, url: string, includeImages: boolean): Promise<Article> {
	const document = new DOMParser().parseFromString(html, 'text/html');
	if (!document.querySelector('base[href]')) {
		const base = document.createElement('base');
		base.href = url;
		document.head.prepend(base);
	}

	const parsed = new Readability(document).parse();
	if (!parsed?.content) {
		throw new Error('No article found on this page.');
	}

	const content = new DOMParser().parseFromString(
		`<!doctype html><html><head><base href="${url.replaceAll('"', '&quot;')}"></head><body>${parsed.content}</body></html>`,
		'text/html',
	);
	const root = content.body;
	clean(root);
	const images = await embedImages(root, includeImages);
	const title = parsed.title?.trim() || document.title.trim() || new URL(url).hostname;
	const epub = buildEpub({
		title,
		author: parsed.byline?.trim() || undefined,
		language: parsed.lang || document.documentElement.lang || undefined,
		source: url,
		bodyXhtml: serialize(root),
		images,
		identifier: `urn:uuid:${crypto.randomUUID()}`,
		modified: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
	});
	return {title, epub};
}
