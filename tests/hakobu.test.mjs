// 運ぶ道具の 自己試験（名札を 運ばない・git の外を 運ばない・0本を 緑にしない）
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const r = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'hakobu.mjs'), '--self-test'], { encoding: 'utf8' });
process.stdout.write(r.stdout + r.stderr);
process.exit(r.status);
