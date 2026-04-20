import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../data/store.json');

const defaultData = {
  users: [
    {
      id: 'u1',
      name: 'Super Admin',
      email: 'admin@guganfashions.com',
      passwordHash: '',
      role: 'admin',
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'u2',
      name: 'Customer',
      email: 'user@guganfashions.com',
      passwordHash: '',
      role: 'user',
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  settings: {
    lowStockThreshold: 10,
  },
  products: [
    {
      id: 'p1',
      name: 'Kanchipuram Silk Saree',
      description: 'Handwoven silk saree with zari border.',
      category: 'Sarees',
      brand: 'Gugan Fashions',
      basePrice: 5499,
      status: 'ACTIVE',
      isArchived: false,
      archivedAt: null,
      images: [
        {
          id: 'img1',
          url: 'https://images.unsplash.com/photo-1610189027563-6c6f7f399bb4?auto=format&fit=crop&w=800&q=80',
          sortOrder: 1,
          isPrimary: true,
        },
      ],
      variants: [
        { id: 'v1', size: 'M', color: 'Maroon', stockQuantity: 8 },
        { id: 'v2', size: 'L', color: 'Royal Blue', stockQuantity: 14 },
      ],
      discount: {
        type: 'PERCENTAGE',
        value: 10,
        startsAt: null,
        expiresAt: null,
        isActive: true,
        finalPrice: 4949,
      },
      auditLogs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'p2',
      name: 'Cotton Kurti Set',
      description: 'Comfort fit daily-wear kurti with dupatta.',
      category: 'Kurtis',
      brand: 'Gugan Fashions',
      basePrice: 1799,
      status: 'ACTIVE',
      isArchived: false,
      archivedAt: null,
      images: [
        {
          id: 'img2',
          url: 'https://images.unsplash.com/photo-1583391733981-8e7f1a0e7f4b?auto=format&fit=crop&w=800&q=80',
          sortOrder: 1,
          isPrimary: true,
        },
      ],
      variants: [
        { id: 'v3', size: 'S', color: 'Mint', stockQuantity: 25 },
        { id: 'v4', size: 'M', color: 'Peach', stockQuantity: 6 },
      ],
      discount: {
        type: null,
        value: null,
        startsAt: null,
        expiresAt: null,
        isActive: false,
        finalPrice: 1799,
      },
      auditLogs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  orders: [
    {
      id: 'o1',
      orderNumber: 'GF-1001',
      customerName: 'Priya Raman',
      customerEmail: 'priya@example.com',
      shippingAddress: '12, Lake View Road, Chennai',
      status: 'ORDER_PLACED',
      lineItems: [
        {
          productId: 'p1',
          productName: 'Kanchipuram Silk Saree',
          variant: 'M / Maroon',
          quantity: 1,
          unitPrice: 4949,
        },
      ],
      totalAmount: 4949,
      statusHistory: [
        {
          status: 'ORDER_PLACED',
          note: 'Order created',
          changedAt: new Date().toISOString(),
          changedBy: 'system',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};

let writeQueue = Promise.resolve();

async function ensureDb() {
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    const seeded = structuredClone(defaultData);
    seeded.users[0].passwordHash = bcrypt.hashSync('admin123', 10);
    seeded.users[1].passwordHash = bcrypt.hashSync('user1234', 10);
    await fs.writeFile(DB_PATH, JSON.stringify(seeded, null, 2), 'utf-8');
  }

  const raw = await fs.readFile(DB_PATH, 'utf-8');
  const data = JSON.parse(raw);
  let changed = false;

  for (const user of data.users ?? []) {
    if (user.role && user.role !== 'admin' && user.role !== 'user') {
      user.role = 'admin';
      changed = true;
    }
  }

  const adminUser = data.users?.find((user) => user.email?.toLowerCase() === 'admin@guganfashions.com');
  if (adminUser && !adminUser.passwordHash) {
    adminUser.passwordHash = bcrypt.hashSync('admin123', 10);
    adminUser.role = 'admin';
    changed = true;
  }

  const demoUser = data.users?.find((user) => user.email?.toLowerCase() === 'user@guganfashions.com');
  if (!demoUser) {
    data.users.push({
      id: 'u2',
      name: 'Customer',
      email: 'user@guganfashions.com',
      passwordHash: bcrypt.hashSync('user1234', 10),
      role: 'user',
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    changed = true;
  }

  if (demoUser && demoUser.name === 'Demo User') {
    demoUser.name = 'Customer';
    changed = true;
  }

  if (changed) await writeDb(data);
}

export async function readDb() {
  await ensureDb();
  const raw = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

export async function writeDb(data) {
  writeQueue = writeQueue.then(() => fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), 'utf-8'));
  await writeQueue;
}

export async function updateDb(mutator) {
  const db = await readDb();
  const next = await mutator(db);
  await writeDb(next ?? db);
  return next ?? db;
}

export function generateId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
