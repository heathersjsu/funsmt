const { encodeChunkCommands } = require('./chunk.runtime');

function assertEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg || `assertEqual failed\n${JSON.stringify(a)}\n${JSON.stringify(b)}`);
  }
}

(function run() {
  const text = 'abcdefghijklmnopqrstuvwxyz';
  const cmds = encodeChunkCommands('SUPA_CFG', text, 16);
  assertEqual(cmds[0], `SUPA_CFG_BEGIN ${text.length}`);
  const dataCmds = cmds.slice(1, -1);
  assertEqual(dataCmds[0], `SUPA_CFG_DATA 0 ${text.substring(0,16)}`);
  assertEqual(dataCmds[1], `SUPA_CFG_DATA 1 ${text.substring(16,32)}`);
  assertEqual(cmds[cmds.length - 1], 'SUPA_CFG_END');
  const jwt = JSON.stringify({ jwt: 'x'.repeat(40) });
  const cmds2 = encodeChunkCommands('JWT_SET', jwt, 16);
  assertEqual(cmds2[0], `JWT_SET_BEGIN ${jwt.length}`);
  assertEqual(cmds2[cmds2.length - 1], 'JWT_SET_END');
  console.log('chunk.test passed');
})();