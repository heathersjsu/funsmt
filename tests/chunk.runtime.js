function encodeChunkCommands(tag, text, chunkSize = 16) {
  const total = text.length;
  const cmds = [tag + '_BEGIN ' + total];
  let seq = 0;
  for (let i = 0; i < total; i += chunkSize) {
    const part = text.substring(i, i + chunkSize);
    cmds.push(tag + '_DATA ' + seq + ' ' + part);
    seq++;
  }
  cmds.push(tag + '_END');
  return cmds;
}

module.exports = { encodeChunkCommands };