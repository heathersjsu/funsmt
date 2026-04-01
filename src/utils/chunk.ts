export type ChunkTag = 'SUPA_CFG' | 'JWT_SET';

export function encodeChunkCommands(tag: ChunkTag, text: string, chunkSize = 16): string[] {
  const total = text.length;
  const cmds: string[] = [`${tag}_BEGIN ${total}`];
  let seq = 0;
  for (let i = 0; i < total; i += chunkSize) {
    const part = text.substring(i, i + chunkSize);
    cmds.push(`${tag}_DATA ${seq} ${part}`);
    seq++;
  }
  cmds.push(`${tag}_END`);
  return cmds;
}