// Messages between the popup / options page and the background script.

export type Message =
	| {type: 'send'; tabId: number; name?: string}
	| {type: 'register'; code: string}
	| {type: 'signOut'};

export type Reply = {ok: true; detail?: string} | {ok: false; error: string};

export async function send(message: Message): Promise<Reply> {
	return browser.runtime.sendMessage(message) as Promise<Reply>;
}
