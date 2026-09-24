#!/usr/bin/env tsx

import { execFileSync, spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'jsonc-parser';

interface WranglerConfig {
  secrets_store_secrets?: Array<{
    binding: string;
    store_id: string;
    secret_name: string;
  }>;
}

function execFile(command: string, args: readonly string[], input?: string): string {
  try {
    return execFileSync(command, [...args], { encoding: 'utf8', stdio: 'pipe', input });
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Command failed: ${command} ${args.join(' ')}\n${error.message}`);
    }
    throw new Error(`Command failed: ${command} ${args.join(' ')}\nUnknown error.`);
  }
}

function parseWranglerConfig(): WranglerConfig {
  const configPath = join(process.cwd(), 'wrangler.jsonc');
  const content = readFileSync(configPath, 'utf8');
  return parse(content);
}

function checkSecret(storeId: string, secretName: string): boolean {
  try {
    // Argv array (no shell): `storeId` never interpolates into `sh -c`.
    const output = execFile('pnpm', ['exec', 'wrangler', 'secrets-store', 'secret', 'list', storeId, '--remote']);
    return output.includes(secretName);
  } catch {
    return false;
  }
}

async function generateAESGCMKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

function createSecret(storeId: string, secretName: string, secretValue: string): void {
  console.log(`Creating secret: ${secretName}`);
  // Why `spawnSync` with piped stdin: the previous
  // `echo "${secretValue}" | wrangler ... ${secretName}` broke on `"`, `$`,
  // backticks, and newlines and leaked the value via `ps`. Argv + stdin pipe
  // keeps both the value and the names out of any shell.
  const child = spawnSync(
    'pnpm',
    ['exec', 'wrangler', 'secrets-store', 'secret', 'create', storeId, '--name', secretName, '--scopes', 'workers', '--remote'],
    {
      input: secretValue,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
  if (child.status !== 0) {
    throw new Error(
      `Command failed: wrangler secrets-store secret create ${storeId} --name ${secretName}\n${child.stderr || child.error?.message || 'Unknown error.'}`,
    );
  }
}

async function main() {
  console.log('Initializing Cloudflare secrets...');
  const config = parseWranglerConfig();
  if (config.secrets_store_secrets) {
    for (const secret of config.secrets_store_secrets) {
      if (!checkSecret(secret.store_id, secret.secret_name)) {
        let secretValue: string;
        if (
          secret.secret_name === 'duradav-webhook-encryption-key' ||
          secret.secret_name === 'duradav-mirror-encryption-key' ||
          secret.secret_name === 'duradav-import-encryption-key' ||
          secret.secret_name === 'duradav-aes-encryption-key' ||
          secret.secret_name === 'duradav-action-encryption-key'
        ) {
          secretValue = await generateAESGCMKey();
          console.log(`Generated AES encryption key`);
        } else if (secret.secret_name === 'duradav-action-signing-secret') {
          secretValue = crypto.getRandomValues(new Uint8Array(32)).reduce((value, byte) => value + byte.toString(16).padStart(2, '0'), '');
          console.log(`Generated action signing secret`);
        } else {
          throw new Error(`Unknown secret: ${secret.secret_name}`);
        }
        createSecret(secret.store_id, secret.secret_name, secretValue);
        console.log(`Created secret: ${secret.secret_name}`);
      } else {
        console.log(`Secret ${secret.secret_name} already exists`);
      }
    }
  }
  console.log('Secret initialization complete');
}

main().catch(console.error);
