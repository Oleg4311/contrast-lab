// Сборка: страница одним файлом + version.json с коммитом в каталог site/.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

rmSync('site', { recursive: true, force: true });
mkdirSync('site');
copyFileSync('index.html', 'site/index.html');

let commit = process.env.GITHUB_SHA;
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    commit = undefined;
  }
}
if (commit) writeFileSync('site/version.json', JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log('site/ готов');
