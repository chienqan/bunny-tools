// core/stream - typed wrappers for Stream library + video CRUD. UI-free.
// Library CRUD uses account scope. Video CRUD uses per-library scope.

import { readFile } from 'node:fs/promises';
import { createStreamClient } from '../api/stream.js';
import type { Video, VideoLibrary } from '../api/stream.js';
import { resolveScopedCredential } from './scoped-key-resolver.js';

// Video calls need the per-library key; the scoped resolver fetches it with
// the account key when none is stored.
function client() {
  return createStreamClient({ resolveCredential: (s) => resolveScopedCredential(s) });
}

// Library API keys are stripped from results; video commands fetch them on demand.
export type PublicVideoLibrary = Omit<VideoLibrary, 'ApiKey' | 'ReadOnlyApiKey'>;
function toPublicLibrary(l: VideoLibrary): PublicVideoLibrary {
  const { ApiKey: _k, ReadOnlyApiKey: _r, ...rest } = l;
  return rest;
}

export async function listLibraries(): Promise<PublicVideoLibrary[]> {
  return (await client().listLibraries()).map(toPublicLibrary);
}

export async function getLibrary(id: number): Promise<PublicVideoLibrary> {
  return toPublicLibrary(await client().getLibrary(id));
}

export async function createLibrary(name: string, replicationRegions?: string[]): Promise<PublicVideoLibrary> {
  return toPublicLibrary(await client().createLibrary(name, replicationRegions));
}

export async function deleteLibrary(id: number): Promise<void> {
  await client().deleteLibrary(id);
}

export async function listVideos(libraryId: string | number, collection?: string): Promise<Video[]> {
  const r = await client().listVideos(libraryId, collection ? { collection } : undefined);
  return r.items ?? [];
}

export type UploadResult = { guid: string; bytes: number };

// Two-step upload: create video metadata → PUT bytes.
export async function uploadVideo(
  libraryId: string | number,
  localPath: string,
  title?: string,
  collectionId?: string,
): Promise<UploadResult> {
  const c = client();
  const created = await c.createVideo(
    libraryId,
    title ?? localPath.split(/[/\\]/).pop() ?? 'video',
    collectionId,
  );
  const buf = await readFile(localPath);
  await c.uploadVideoBytes(libraryId, created.guid, buf);
  return { guid: created.guid, bytes: buf.length };
}

export async function deleteVideo(libraryId: string | number, videoGuid: string): Promise<void> {
  await client().deleteVideo(libraryId, videoGuid);
}
