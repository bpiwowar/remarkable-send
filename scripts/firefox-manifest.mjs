// After the Parcel build: drop background.service_worker (Parcel requires it,
// Firefox ignores it and uses background.scripts) and its duplicate bundle.
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const directory = process.argv[2] ?? 'distribution';
const file = path.join(directory, 'manifest.json');
const manifest = JSON.parse(readFileSync(file, 'utf8'));
const worker = manifest.background?.service_worker;
if (worker) {
	delete manifest.background.service_worker;
	if (!manifest.background.scripts?.includes(worker)) {
		rmSync(path.join(directory, worker), {force: true});
	}

	writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}
