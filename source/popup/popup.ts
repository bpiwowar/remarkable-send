import {send} from '../messages.js';
import {getSettings} from '../settings.js';

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;

function setStatus(text: string, kind: '' | 'ok' | 'error' = ''): void {
	const status = $('status');
	status.textContent = text;
	status.className = `status ${kind}`;
}

async function main(): Promise<void> {
	const settings = await getSettings();
	const [tab] = await browser.tabs.query({active: true, currentWindow: true});

	$('options').addEventListener('click', event => {
		event.preventDefault();
		void browser.runtime.openOptionsPage();
		window.close();
	});
	$('connect').addEventListener('click', () => {
		void browser.runtime.openOptionsPage();
		window.close();
	});

	if (!settings.deviceToken) {
		$('signedOut').hidden = false;
		return;
	}

	$('signedIn').hidden = false;
	const name = $<HTMLInputElement>('name');
	name.value = tab?.title ?? '';
	name.placeholder = 'Name (default: the page title)';
	$('folder').textContent = `→ ${settings.folder || 'My files'}`;

	const button = $<HTMLButtonElement>('send');
	if (!tab?.id || !/^https?:/.test(tab.url ?? '')) {
		button.disabled = true;
		setStatus('Only web pages (http or https) can be sent.', 'error');
		return;
	}

	const tabId = tab.id;
	const initialTitle = name.value;
	const submit = async () => {
		button.disabled = true;
		setStatus('Sending…');
		// An unchanged name lets the document's own title win (article, PDF metadata).
		const edited = name.value.trim() && name.value !== initialTitle ? name.value.trim() : undefined;
		const reply = await send({type: 'send', tabId, name: edited});
		if (reply.ok) {
			setStatus(`Sent ${reply.detail ?? ''}`, 'ok');
		} else {
			setStatus(reply.error, 'error');
			button.disabled = false;
		}
	};

	button.addEventListener('click', () => {
		void submit();
	});
	name.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !button.disabled) {
			void submit();
		}
	});
	button.focus();
}

void main();
