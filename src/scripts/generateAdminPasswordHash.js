const bcrypt = require('bcryptjs');

const { stdin, stdout } = process;

if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
  console.error('Run this command directly in a terminal so the password can be entered without echo.');
  process.exitCode = 1;
} else {
  let password = '';
  let finished = false;
  stdout.write('Admin password (12-72 UTF-8 bytes, input hidden): ');
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  stdin.on('data', async input => {
    for (const character of input) {
      if (character === '\u0003') {
        password = '';
        finished = true;
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write('\nCancelled.\n');
        return;
      }
      if (character === '\r' || character === '\n') {
        if (finished) return;
        finished = true;
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write('\n');
        const passwordBytes = Buffer.byteLength(password, 'utf8');
        if (passwordBytes < 12 || passwordBytes > 72) {
          password = '';
          console.error('Use a password between 12 and 72 UTF-8 bytes.');
          process.exitCode = 1;
          return;
        }
        try {
          const passwordHash = await bcrypt.hash(password, 12);
          password = '';
          console.log(`ADMIN_PASSWORD_HASH=${passwordHash}`);
        } catch {
          password = '';
          console.error('Could not generate the password hash.');
          process.exitCode = 1;
        }
        return;
      }
      if (character === '\u007f' || character === '\b') {
        password = Array.from(password).slice(0, -1).join('');
      } else {
        password += character;
      }
    }
  });
}