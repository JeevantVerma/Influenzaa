// Creates a platform admin. Credentials come from the environment, never argv:
//   ADMIN_EMAIL=ops@example.com ADMIN_PASSWORD='...' npm run create-admin -w server
import { getConfig } from '../src/config/env.js';
import { connectDatabase, initializeDatabase, disconnectDatabase } from '../src/db/connect.js';
import { User } from '../src/models/index.js';
import { hashPassword } from '../src/lib/crypto.js';

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Platform Admin' } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters).');
  process.exit(1);
}
await connectDatabase(getConfig().mongoUri);
await initializeDatabase();
const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });
if (existing) {
  console.error('A user with that email already exists.');
} else {
  await User.create({ email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash: await hashPassword(ADMIN_PASSWORD), role: 'admin' });
  console.log('Admin created.');
}
await disconnectDatabase();
