import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const GIST_ID    = process.env.GITHUB_GIST_ID;
const GIST_TOKEN = process.env.GITHUB_GIST_TOKEN;
const FILE_NAME  = 'markets-data.json';

function gistHeaders() {
  return {
    Authorization: `Bearer ${GIST_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function readGist(): Promise<Record<string, unknown>> {
  if (!GIST_ID || !GIST_TOKEN) return {};
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: gistHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return {};
    const gist = await res.json() as { files: Record<string, { content: string }> };
    const content = gist.files?.[FILE_NAME]?.content;
    if (!content) return {};
    return JSON.parse(content) as Record<string, unknown>;
  } catch { return {}; }
}

async function writeGist(data: Record<string, unknown>): Promise<boolean> {
  if (!GIST_ID || !GIST_TOKEN) return false;
  try {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: { ...gistHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: { [FILE_NAME]: { content: JSON.stringify(data, null, 2) } },
      }),
    });
    return res.ok;
  } catch { return false; }
}

function deepMerge(
  base: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(update)) {
    const b = base[key];
    const u = update[key];
    if (
      b && typeof b === 'object' && !Array.isArray(b) &&
      u && typeof u === 'object' && !Array.isArray(u)
    ) {
      result[key] = deepMerge(
        b as Record<string, unknown>,
        u as Record<string, unknown>,
      );
    } else {
      result[key] = u;
    }
  }
  return result;
}

export async function GET() {
  const data = await readGist();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const update = await req.json() as Record<string, unknown>;
  const existing = await readGist();
  const merged = deepMerge(existing, update);
  const ok = await writeGist(merged);
  return NextResponse.json({ ok, data: merged });
}
