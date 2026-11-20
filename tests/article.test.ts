// The article -> ePub path and the file helpers, in Node (jsdom for the DOM).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {strFromU8, unzipSync} from 'fflate';
import {JSDOM} from 'jsdom';

const {window} = new JSDOM('');
Object.assign(globalThis, {DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer});

const {articleEpub, pickSrcset} = await import('../source/article.js');
const {dispositionFileName} = await import('../source/capture.js');
const {sniff} = await import('../source/document.js');

// A 1×1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const paragraph = 'The quick brown fox jumps over the lazy dog, again and again, in a made-up article. ';
const PAGE = `<!doctype html>
<html lang="en"><head><title>Made-up Article — Example News</title>
<meta name="author" content="Jane Example"><script>alert(1)</script></head>
<body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<article>
<h1>Made-up Article</h1>
<p class="byline">By Jane Example</p>
${Array.from({length: 8}, (_, i) => `<p>${paragraph.repeat(4)}<a href="/more/${i}" onclick="x()">more</a> &amp; &nbsp;&lt;tags&gt;<br></p>`).join('\n')}
<figure><picture><source srcset="big.webp"><img src="${PNG}" alt="A pixel"></picture><figcaption>A pixel</figcaption></figure>
<p><img src="javascript:alert(1)"> <img src="ftp://example.org/x.png"></p>
<iframe src="https://example.org/embed"></iframe>
</article>
<footer>Footer</footer>
</body></html>`;

test('an article becomes a valid ePub', async () => {
	const {title, epub} = await articleEpub(PAGE, 'https://news.example.org/2026/article.html', true);
	assert.match(title, /^Made-up Article/);
	assert.equal(sniff(epub), 'epub');

	const files = unzipSync(epub);
	assert.equal(Object.keys(files)[0], 'mimetype');
	assert.deepEqual(Object.keys(files).sort(), [
		'META-INF/container.xml',
		'OEBPS/chapter.xhtml',
		'OEBPS/content.opf',
		'OEBPS/images/1.png',
		'OEBPS/nav.xhtml',
		'OEBPS/style.css',
		'mimetype',
	]);

	const parser = new window.DOMParser();
	for (const name of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/chapter.xhtml']) {
		const xml = parser.parseFromString(strFromU8(files[name]), 'application/xml');
		assert.equal(xml.querySelector('parsererror'), null, `${name} is not well-formed`);
	}

	const chapter = strFromU8(files['OEBPS/chapter.xhtml']);
	assert.match(chapter, /src="images\/1.png"/);
	assert.match(chapter, /href="https:\/\/news.example.org\/more\/0"/);
	assert.doesNotMatch(chapter, /<script|<iframe|onclick|srcset|javascript:|ftp:/);
	assert.match(strFromU8(files['OEBPS/content.opf']), /<dc:creator>.*Jane Example/);
});

test('images can be left out', async () => {
	const {epub} = await articleEpub(PAGE, 'https://news.example.org/a.html', false);
	const files = unzipSync(epub);
	assert.ok(!Object.keys(files).some(name => name.includes('images/')));
	assert.doesNotMatch(strFromU8(files['OEBPS/chapter.xhtml']), /<img/);
});

test('a page without an article is refused', async () => {
	await assert.rejects(articleEpub('<html><body></body></html>', 'https://example.org/', true), /No article/);
});

test('srcset candidates', () => {
	assert.equal(pickSrcset('a.jpg 400w, b.jpg 1200w, c.jpg 2400w'), 'b.jpg');
	assert.equal(pickSrcset('c.jpg 2400w, d.jpg 3000w'), 'c.jpg');
	assert.equal(pickSrcset('a.jpg, b.jpg 2x'), 'b.jpg');
	assert.equal(pickSrcset('https://cdn.example.org/i.jpg?w=300,h=200 300w'), 'https://cdn.example.org/i.jpg?w=300,h=200');
	assert.equal(pickSrcset(''), undefined);
});

test('sniff', () => {
	const bytes = (text: string) => new TextEncoder().encode(text);
	assert.equal(sniff(bytes('%PDF-1.7\n…')), 'pdf');
	assert.equal(sniff(bytes('\n\n%PDF-1.4')), 'pdf');
	assert.equal(sniff(bytes('<!doctype html>')), undefined);
	assert.equal(sniff(bytes('PK\u0003\u0004' + 'x'.repeat(26) + 'mimetypeapplication/epub+zip')), 'epub');
	assert.equal(sniff(bytes('PK\u0003\u0004' + 'x'.repeat(26) + 'word/document.xml')), undefined);
});

test('Content-Disposition file names', () => {
	assert.equal(dispositionFileName('attachment; filename="report.pdf"'), 'report.pdf');
	assert.equal(dispositionFileName('inline; filename=report.pdf'), 'report.pdf');
	assert.equal(dispositionFileName('attachment; filename="x.pdf"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.pdf'), 'résumé.pdf');
	assert.equal(dispositionFileName('inline'), undefined);
	assert.equal(dispositionFileName(undefined), undefined);
});
