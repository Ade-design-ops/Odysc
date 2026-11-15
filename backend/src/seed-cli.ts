import { Store } from './db.js';
import { seedDemo } from './seed.js';

if (process.env.DATABASE_BACKEND !== 'sqlite') {
  throw new Error('Demo seeding is local only. Select DATABASE_BACKEND=sqlite explicitly before running this command.');
}
const store = new Store(process.env.DATABASE_PATH);
try {
  const accounts = await seedDemo(store);
  console.log('Fictional demo fixtures are ready. Never use these accounts for real student data.');
  console.log(accounts);
} finally {
  store.close();
}
