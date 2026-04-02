import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { processImage, parseImageReferences } from './image.js';

// Create a minimal 10x10 JPEG buffer for testing (won't be valid JPEG but sharp handles it)
// We'll use a real minimal JPEG instead
const MINIMAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=',
  'base64',
);

describe('processImage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-image-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null for empty buffer', async () => {
    const result = await processImage(Buffer.alloc(0), tmpDir);
    expect(result).toBeNull();
  });

  it('should save a resized JPEG to the attachments directory', async () => {
    const result = await processImage(MINIMAL_JPEG, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.relativePath).toMatch(/^attachments\/img-\d+-[a-z0-9]+\.jpg$/);
    expect(result!.content).toContain(result!.relativePath);

    const filePath = path.join(tmpDir, result!.relativePath);
    expect(fs.existsSync(filePath)).toBe(true);

    const stat = fs.statSync(filePath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('should include caption in content', async () => {
    const result = await processImage(MINIMAL_JPEG, tmpDir, 'Hello world');
    expect(result).not.toBeNull();
    expect(result!.content).toContain('Hello world');
  });

  it('should not include caption when not provided', async () => {
    const result = await processImage(MINIMAL_JPEG, tmpDir);
    expect(result).not.toBeNull();
    // Content should start with [Image: and have no extra text after the ]
    const match = result!.content.match(/^\[Image: attachments\/img-[^\]]+\]$/);
    expect(match).not.toBeNull();
  });
});

describe('parseImageReferences', () => {
  it('should extract image references from messages', () => {
    const messages = [
      { content: '[Image: attachments/img-123-abc.jpg]' },
      { content: 'Hello world' },
      { content: 'Check this [Image: attachments/img-456-def.jpg] out' },
    ];

    const refs = parseImageReferences(messages);
    expect(refs).toHaveLength(2);
    expect(refs[0].relativePath).toBe('attachments/img-123-abc.jpg');
    expect(refs[0].mediaType).toBe('image/jpeg');
    expect(refs[1].relativePath).toBe('attachments/img-456-def.jpg');
  });

  it('should return empty array when no image references exist', () => {
    const messages = [
      { content: 'Hello world' },
      { content: 'No images here' },
    ];

    const refs = parseImageReferences(messages);
    expect(refs).toHaveLength(0);
  });

  it('should handle multiple images in a single message', () => {
    const messages = [
      { content: '[Image: attachments/img-1.jpg] and [Image: attachments/img-2.jpg]' },
    ];

    const refs = parseImageReferences(messages);
    expect(refs).toHaveLength(2);
  });
});
