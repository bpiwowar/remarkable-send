import {send} from '../messages.js';
import {getSettings, setSettings} from '../settings.js';

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;

const ORIGINS = {origins: ['<all_urls>']};

function setStatus(id: string, text: string, kind: '' | 'ok' | 'error' = ''): void {
	const status = $(id);
	status.textContent = text;
	status.className = `status ${kind}`;
}

async function refreshPermissions(): Promise<void> {
	$('permissions').hidden = await browser.permissions.contains(ORIGINS);
}

async function refreshAccount(): Promise<void> {
	const {deviceToken} = await getSettings();
	$('signedIn').hidden = !deviceToken;
	$('signedOut').hidden = Boolean(deviceToken);
}

async function main(): Promise<void> {
	const settings = await getSettings();
	await refreshPermissions();
	await refreshAccount();

	$('grant').addEventListener('click', async () => {
		await browser.permissions.request(ORIGINS);
		await refreshPermissions();
	});

	const code = $<HTMLInputElement>('code');
	const connect = $<HTMLButtonElement>('connect');
	const doConnect = async () => {
		if (!code.value.trim()) {
			return;
		}

		connect.disabled = true;
		setStatus('accountStatus', 'Connecting…');
		const reply = await send({type: 'register', code: code.value});
		connect.disabled = false;
		if (reply.ok) {
			code.value = '';
			setStatus('accountStatus', 'Connected.', 'ok');
		} else {
			setStatus('accountStatus', reply.error, 'error');
		}

		await refreshAccount();
	};

	connect.addEventListener('click', () => {
		void doConnect();
	});
	code.addEventListener('keydown', event => {
		if (event.key === 'Enter') {
			void doConnect();
		}
	});
	$('signOut').addEventListener('click', async () => {
		await send({type: 'signOut'});
		setStatus('accountStatus', 'Disconnected.');
		await refreshAccount();
	});

	const folder = $<HTMLInputElement>('folder');
	const images = $<HTMLInputElement>('images');
	folder.value = settings.folder;
	images.checked = settings.images;
	const saved = () => {
		setStatus('saved', 'Saved.', 'ok');
		setTimeout(() => {
			setStatus('saved', '');
		}, 1500);
	};

	folder.addEventListener('change', async () => {
		const value = folder.value.split('/').map(p => p.trim()).filter(Boolean).join('/');
		folder.value = value;
		await setSettings({folder: value});
		saved();
	});
	images.addEventListener('change', async () => {
		await setSettings({images: images.checked});
		saved();
	});
}

void main();
