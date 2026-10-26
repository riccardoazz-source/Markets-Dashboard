import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const FILE_NAME = 'markets-data.json';

function gistEnv() {
  return {
    id: process.env.GITHUB_GIST_ID,
    token: process.env.GITHUB_GIST_TOKEN,
  };
}

function gistHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function readGist(): Promise<Record<string, unknown>> {
  const r = await readGistRaw();
  return r.data;
}

/**
 * The read, with everything the diagnosis needs kept alongside the data: the HTTP status
 * GitHub answered with, the gist's own `updated_at`, and the first line of any error body.
 *
 * `cloud: true` has only ever meant "both env vars are set". It said nothing about whether
 * the token still WORKS, and a token that reads fine can still have expired for writes —
 * or never had write permission. The symptom of that is exactly the one reported: every
 * device sees the same frozen server copy, the device that typed something keeps it
 * locally and looks fine, and nothing says anything, because the write path ends in a
 * `.catch(() => {})` and then sets 'synced' anyway.
 */
async function readGistRaw(): Promise<{
  data: Record<string, unknown>; status: number | null; updatedAt: string | null; error: string | null;
}> {
  const { id, token } = gistEnv();
  if (!id || !token) return { data: {}, status: null, updatedAt: null, error: 'not configured' };
  try {
    const res = await fetch(`https://api.github.com/gists/${id}`, {
      headers: gistHeaders(token),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { data: {}, status: res.status, updatedAt: null, error: body.slice(0, 200) || res.statusText };
    }
    const gist = await res.json() as { updated_at?: string; files: Record<string, { content: string }> };
    const content = gist.files?.[FILE_NAME]?.content;
    const data = content ? JSON.parse(content) as Record<string, unknown> : {};
    return { data, status: res.status, updatedAt: gist.updated_at ?? null, error: null };
  } catch (e) {
    return { data: {}, status: null, updatedAt: null, error: (e as Error).message };
  }
}

/** The write, with GitHub's answer kept — a 401 and a 403 are different diagnoses. */
async function writeGistRaw(data: Record<string, unknown>): Promise<{
  ok: boolean; status: number | null; error: string | null; bytes: number;
}> {
  const { id, token } = gistEnv();
  const content = JSON.stringify(data, null, 2);
  if (!id || !token) return { ok: false, status: null, error: 'not configured', bytes: content.length };
  try {
    const res = await fetch(`https://api.github.com/gists/${id}`, {
      method: 'PATCH',
      headers: { ...gistHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { [FILE_NAME]: { content } } }),
    });
    if (res.ok) return { ok: true, status: res.status, error: null, bytes: content.length };
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: body.slice(0, 200) || res.statusText, bytes: content.length };
  } catch (e) {
    return { ok: false, status: null, error: (e as Error).message, bytes: content.length };
  }
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

export async function GET(req: NextRequest) {
  const { id, token } = gistEnv();
  const cloud = !!(id && token);

  // ?mode=diag — the question nothing else could answer: does the server, right now,
  // succeed at WRITING? It reads with the token and reports GitHub's status and the
  // gist's own updated_at (the last time anything landed), then, with &write=1, writes
  // one harmless timestamp key and reports what GitHub said. One URL, any device, no
  // interpretation needed.
  if (req.nextUrl.searchParams.get('mode') === 'diag') {
    const read = await readGistRaw();
    const keys = Object.keys(read.data);
    const noteCharts = Object.keys((read.data.notes as Record<string, unknown> | undefined) ?? {}).length;
    let write: { attempted: boolean; ok?: boolean; status?: number | null; error?: string | null; bytes?: number } = { attempted: false };
    if (req.nextUrl.searchParams.get('write') === '1' && cloud && read.status === 200) {
      const r = await writeGistRaw({ ...read.data, _diagAt: new Date().toISOString() });
      write = { attempted: true, ...r };
    }
    return NextResponse.json({
      configured: cloud,
      tokenPrefix: token ? `${token.slice(0, 8)}…` : null,
      read: { status: read.status, error: read.error, keys, noteCharts, lastServerWrite: read.updatedAt },
      write,
      verdict: !cloud ? 'not configured'
        : read.status !== 200 ? `read FAILS (HTTP ${read.status}) — the token or gist id is wrong or expired`
        : write.attempted && !write.ok ? `read works, write FAILS (HTTP ${write.status}) — the token has expired or lacks gist write permission`
        : write.attempted ? 'read and write both work'
        : 'read works — add &write=1 to test writing',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const data = await readGist();
  return NextResponse.json({ cloud, data });
}

export async function POST(req: NextRequest) {
  const { id, token } = gistEnv();
  const cloud = !!(id && token);
  const update = await req.json() as Record<string, unknown>;
  if (!cloud) {
    // No cloud storage configured — nothing to persist server-side.
    return NextResponse.json({ ok: false, cloud: false });
  }
  const existing = await readGist();
  const merged = deepMerge(existing, update);
  const r = await writeGistRaw(merged);
  // The failure is carried back rather than flattened to `ok: false`: the client turns
  // the badge red, and the panel can say WHY instead of "sync error".
  return NextResponse.json({ ok: r.ok, cloud: true, status: r.status, error: r.error });
}
