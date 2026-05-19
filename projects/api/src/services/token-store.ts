import fs from 'fs';
import path from 'path';

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// Resolve store path at repo root
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'turbo.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const STORE_PATH = path.join(findRepoRoot(__dirname), '.data', 'tokens.json');

export class TokenStore {
  private tokens: Map<string, StoredTokens> = new Map();

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
        this.tokens = new Map(Object.entries(data));
      }
    } catch {
      this.tokens = new Map();
    }
  }

  private save() {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj = Object.fromEntries(this.tokens);
    fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  }

  get(telegramUserId: string): StoredTokens | null {
    return this.tokens.get(telegramUserId) ?? null;
  }

  set(telegramUserId: string, tokens: StoredTokens) {
    this.tokens.set(telegramUserId, tokens);
    this.save();
  }

  delete(telegramUserId: string) {
    this.tokens.delete(telegramUserId);
    this.save();
  }
}

export const tokenStore = new TokenStore();
