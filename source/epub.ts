// A minimal EPUB 3 writer: one XHTML chapter, its images, a navigation document.
import {strToU8, zipSync, type Zippable} from 'fflate';

export type EpubImage = {
	/** Path inside the EPUB, relative to the chapter (e.g. "images/1.jpg"). */
	path: string;
	mediaType: string;
	bytes: Uint8Array;
};

export type EpubBook = {
	title: string;
	author?: string;
	language?: string;
	/** The page the article comes from. */
	source?: string;
	/** The chapter's body, serialized as XHTML (the inside of <body>). */
	bodyXhtml: string;
	images: EpubImage[];
	/** A unique identifier (e.g. a urn:uuid:). */
	identifier: string;
	/** ISO date-time of modification. */
	modified: string;
};

export function escapeXml(text: string): string {
	return text.replaceAll(/[<>&"']/g, c => ({
		'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&apos;',
	})[c]!);
}

const STYLE = `body { font-family: serif; line-height: 1.4; margin: 0 0.5em; }
h1 { font-size: 1.6em; line-height: 1.2; }
.byline, .source { font-style: italic; color: #444; }
img, svg, video { max-width: 100%; height: auto; }
figure { margin: 1em 0; }
figcaption { font-size: 0.85em; color: #444; }
pre { white-space: pre-wrap; font-size: 0.85em; }
blockquote { margin-left: 1em; padding-left: 0.8em; border-left: 3px solid #999; }
table { border-collapse: collapse; }
td, th { border: 1px solid #999; padding: 0.2em 0.4em; }
`;

export function buildEpub(book: EpubBook): Uint8Array {
	const lang = escapeXml(book.language || 'en');
	const title = escapeXml(book.title);
	const header = [
		`<h1>${title}</h1>`,
		book.author ? `<p class="byline">${escapeXml(book.author)}</p>` : '',
		book.source ? `<p class="source"><a href="${escapeXml(book.source)}">${escapeXml(book.source)}</a></p>` : '',
	].join('\n');

	const chapter = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${header}
${book.bodyXhtml}
</body>
</html>
`;

	const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${title}</title></head>
<body>
<nav epub:type="toc" id="toc"><ol><li><a href="chapter.xhtml">${title}</a></li></ol></nav>
</body>
</html>
`;

	const imageItems = book.images.map((image, i) =>
		`<item id="img${i}" href="${escapeXml(image.path)}" media-type="${escapeXml(image.mediaType)}"/>`).join('\n    ');

	const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escapeXml(book.identifier)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>${lang}</dc:language>
    ${book.author ? `<dc:creator>${escapeXml(book.author)}</dc:creator>` : ''}
    ${book.source ? `<dc:source>${escapeXml(book.source)}</dc:source>` : ''}
    <meta property="dcterms:modified">${escapeXml(book.modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    ${imageItems}
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>
`;

	const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

	// The mimetype entry must come first, stored uncompressed.
	const files: Zippable = {
		mimetype: [strToU8('application/epub+zip'), {level: 0}],
		'META-INF/container.xml': strToU8(container),
		'OEBPS/content.opf': strToU8(opf),
		'OEBPS/nav.xhtml': strToU8(nav),
		'OEBPS/chapter.xhtml': strToU8(chapter),
		'OEBPS/style.css': strToU8(STYLE),
	};
	for (const image of book.images) {
		files[`OEBPS/${image.path}`] = [image.bytes, {level: 0}];
	}

	return zipSync(files, {level: 6});
}
