// Stored settings (browser.storage.local).

export type Settings = {
	/** The device token (from a one-time code); absent when not connected. */
	deviceToken?: string;
	/** Destination folder path ("" for the root, "Web/Articles" for a sub-folder). */
	folder: string;
	/** Include the article's images in ePubs. */
	images: boolean;
};

const DEFAULTS: Settings = {folder: '', images: true};

export async function getSettings(): Promise<Settings> {
	const stored = await browser.storage.local.get(['deviceToken', 'folder', 'images']);
	return {...DEFAULTS, ...stored};
}

export async function setSettings(update: Partial<Settings>): Promise<void> {
	await browser.storage.local.set(update);
}

export async function signOut(): Promise<void> {
	await browser.storage.local.remove('deviceToken');
}
