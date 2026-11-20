// Background script: keeps copies of the PDFs/ePubs tabs load, and sends
// pages, links and documents to the reMarkable cloud (toolbar popup, menus).
import {startCapture} from './capture.js';
import {
	forgetSession, register, upload, type Upload,
} from './cloud.js';
import {fromLink, fromTab} from './document.js';
import type {Message, Reply} from './messages.js';
import {getSettings, signOut} from './settings.js';

startCapture();

const MENU_PAGE = 'send-page';
const MENU_LINK = 'send-link';

browser.runtime.onInstalled.addListener(() => {
	browser.menus.create({id: MENU_PAGE, title: 'Send page to reMarkable', contexts: ['page', 'tab']});
	browser.menus.create({id: MENU_LINK, title: 'Send link to reMarkable', contexts: ['link']});
});

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function notify(title: string, message: string): Promise<void> {
	try {
		await browser.notifications.create({
			type: 'basic', iconUrl: browser.runtime.getURL(browser.runtime.getManifest().icons?.['48'] ?? ''), title, message,
		});
	} catch (error) {
		console.warn('notification failed', error);
	}
}

/** Tabs being sent (one at a time per tab). */
const busy = new Set<number>();

async function setBadge(tabId: number | undefined, text: string, color = '#555'): Promise<void> {
	if (tabId === undefined) {
		return;
	}

	try {
		await browser.action.setBadgeBackgroundColor({color, tabId});
		await browser.action.setBadgeText({text, tabId});
	} catch {} // The tab is gone.
}

/** Builds the document (`prepare`) and uploads it, with feedback on the tab's toolbar button. */
async function sendWith(tabId: number | undefined, prepare: (images: boolean) => Promise<Upload>): Promise<Reply> {
	if (tabId !== undefined && busy.has(tabId)) {
		return {ok: false, error: 'Already sending this tab.'};
	}

	if (tabId !== undefined) {
		busy.add(tabId);
	}

	await setBadge(tabId, '…');
	try {
		const settings = await getSettings();
		if (!settings.deviceToken) {
			throw new Error('Not connected to reMarkable: open the extension options to connect.');
		}

		const document = await prepare(settings.images);
		await upload(document, settings.folder);
		const where = settings.folder ? ` in “${settings.folder}”` : '';
		const detail = `“${document.name}” (${document.kind === 'pdf' ? 'PDF' : 'ePub'}, ${Math.ceil(document.bytes.byteLength / 1024)} kB)${where}`;
		await setBadge(tabId, '✓', '#2e7d32');
		await notify('Sent to reMarkable', detail);
		return {ok: true, detail};
	} catch (error) {
		console.error('send failed', error);
		await setBadge(tabId, '!', '#c62828');
		await notify('Not sent to reMarkable', errorMessage(error));
		return {ok: false, error: errorMessage(error)};
	} finally {
		if (tabId !== undefined) {
			busy.delete(tabId);
		}
	}
}

browser.menus.onClicked.addListener((info, tab) => {
	if (info.menuItemId === MENU_LINK && info.linkUrl) {
		const {linkUrl, linkText} = info;
		void sendWith(tab?.id, async images => fromLink(linkUrl, linkText, images));
	} else if (info.menuItemId === MENU_PAGE && tab) {
		void sendWith(tab.id, async images => fromTab(tab, undefined, images));
	}
});

async function handle(message: Message): Promise<Reply> {
	switch (message.type) {
		case 'send': {
			const tab = await browser.tabs.get(message.tabId);
			return sendWith(tab.id, async images => fromTab(tab, message.name, images));
		}

		case 'register': {
			try {
				await register(message.code);
				return {ok: true};
			} catch (error) {
				return {ok: false, error: errorMessage(error)};
			}
		}

		case 'signOut': {
			await signOut();
			forgetSession();
			return {ok: true};
		}

		default: {
			return {ok: false, error: 'unknown message'};
		}
	}
}

browser.runtime.onMessage.addListener(async (message: Message, sender) => {
	// Only the extension's own pages (the options page is in a tab).
	if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/'))) {
		return undefined;
	}

	return handle(message);
});
