import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cwd } from 'node:process';

function releaseDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function updateChanges(changes, version, date) {
  const heading = /^# Changes\r?\n\r?\n## Unreleased - \d{4}-\d{2}-\d{2}$/m;
  if (!heading.test(changes)) {
    throw new Error('Expected the first CHANGES.md section to be "Unreleased - YYYY-MM-DD".');
  }

  const newline = changes.includes('\r\n') ? '\r\n' : '\n';
  return changes.replace(
    /^## Unreleased - \d{4}-\d{2}-\d{2}$/m,
    `## Unreleased - ${date}${newline}${newline}## ${version} - ${date}`,
  );
}

const packagePath = resolve(cwd(), 'package.json');
const changesPath = resolve(cwd(), 'CHANGES.md');
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const changes = await readFile(changesPath, 'utf8');
const updatedChanges = updateChanges(changes, packageJson.version, releaseDate());
await writeFile(changesPath, updatedChanges);
