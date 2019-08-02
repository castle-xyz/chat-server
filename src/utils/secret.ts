let secret: any;

try {
  // For render.com deployment
  secret = require('/etc/secrets/ghost-secret');
} catch (e) {
  try {
    // If you put a symlink in the server/ directory
    let path = '../../ghost-secret';
    secret = require(path);
  } catch (e) {
    try {
      // If you just cloned ghost-secret into a peer directory to ghost-server
      // Typescript tries to build ghost-secret otherwise
      let path = '../../../../ghost-secret';
      secret = require(path);
    } catch (e2) {
      console.error(
        "Couldn't load ghost-secret. Make a symlnk in this directory to where the ghost-secret private repo is."
      );
      throw new Error(e + '\n' + e2);
    }
  }
}

if (process.env.NODE_ENV == 'local') {
  secret.newPostgres = {
    host: '127.0.0.1',
    user: 'castle',
    password: 'castle',
    database: 'castle_small_server',
  };
}

export default secret;
