import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { generateId, readDb, updateDb } from './store.js';

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'gugan-dev-secret';
const API_PREFIX = '/api/v1';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const orderFlow = ['ORDER_PLACED', 'DISPATCHED', 'SHIPPING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const PRODUCT_CATEGORIES = ['Men', 'Women', 'Kids', 'Accessories', 'Footwear', 'Beauty', 'Home', 'Sports', 'Ethnic'];

function computeFinalPrice(basePrice, discount) {
  if (!discount || !discount.isActive || !discount.type || !discount.value) return basePrice;
  if (discount.startsAt && new Date(discount.startsAt) > new Date()) return basePrice;
  if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) return basePrice;

  if (discount.type === 'PERCENTAGE') {
    return Math.max(0, Math.round(basePrice - basePrice * (discount.value / 100)));
  }
  if (discount.type === 'FIXED_AMOUNT') {
    return Math.max(0, Math.round(basePrice - discount.value));
  }
  return basePrice;
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing auth token' });
  }

  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  return next();
}

function userOnly(req, res, next) {
  if (req.user?.role !== 'user') {
    return res.status(403).json({ message: 'User access required' });
  }
  return next();
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

async function processLogin(email, password, expectedRole = null) {
  const db = await readDb();
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    throw new Error('Invalid credentials');
  }

  if (expectedRole && user.role !== expectedRole) {
    throw new Error(expectedRole === 'admin' ? 'Unauthorized: admin account required' : 'Invalid credentials');
  }

  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const err = new Error('Account locked. Try later.');
    err.status = 423;
    throw err;
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    await updateDb((draft) => {
      const current = draft.users.find((u) => u.id === user.id);
      current.failedLoginAttempts += 1;
      if (current.failedLoginAttempts >= 5) {
        current.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        current.failedLoginAttempts = 0;
      }
      current.updatedAt = new Date().toISOString();
      return draft;
    });
    throw new Error('Invalid credentials');
  }

  await updateDb((draft) => {
    const current = draft.users.find((u) => u.id === user.id);
    current.failedLoginAttempts = 0;
    current.lockedUntil = null;
    current.updatedAt = new Date().toISOString();
    return draft;
  });

  return user;
}

app.get(`${API_PREFIX}/health`, (_req, res) => {
  res.json({ status: 'ok', service: 'gugan-fashions-api', time: new Date().toISOString() });
});

app.post(`${API_PREFIX}/auth/user/signup`, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });

  const payload = parsed.data;
  const db = await readDb();
  const existing = db.users.find((u) => u.email.toLowerCase() === payload.email.toLowerCase());
  if (existing) return res.status(409).json({ message: 'Email already in use' });

  const now = new Date().toISOString();
  const user = {
    id: generateId('u'),
    name: payload.name,
    email: payload.email,
    passwordHash: await bcrypt.hash(payload.password, 10),
    role: 'user',
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: now,
    updatedAt: now,
  };

  await updateDb((draft) => {
    draft.users.push(user);
    return draft;
  });

  const token = signToken(user);
  res.status(201).json({
    accessToken: token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    expiresIn: 3600,
  });
});

app.post(`${API_PREFIX}/auth/user/login`, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });

  try {
    const user = await processLogin(parsed.data.email, parsed.data.password, 'user');
    const token = signToken(user);
    return res.json({
      accessToken: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      expiresIn: 3600,
    });
  } catch (error) {
    const status = error.status || (error.message?.includes('Unauthorized') ? 403 : 401);
    return res.status(status).json({ message: error.message || 'Invalid credentials' });
  }
});

app.post(`${API_PREFIX}/auth/admin/login`, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });

  try {
    const user = await processLogin(parsed.data.email, parsed.data.password, 'admin');
    const token = signToken(user);
    return res.json({
      accessToken: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      expiresIn: 3600,
    });
  } catch (error) {
    const status = error.status || (error.message?.includes('Unauthorized') ? 403 : 401);
    return res.status(status).json({ message: error.message || 'Invalid credentials' });
  }
});

app.post(`${API_PREFIX}/auth/login`, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid input' });

  try {
    const user = await processLogin(parsed.data.email, parsed.data.password, 'admin');
    const token = signToken(user);
    return res.json({
      accessToken: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      expiresIn: 3600,
    });
  } catch (error) {
    const status = error.status || (error.message?.includes('Unauthorized') ? 403 : 401);
    return res.status(status).json({ message: error.message || 'Invalid credentials' });
  }
});

app.post(`${API_PREFIX}/auth/logout`, authRequired, (_req, res) => {
  res.json({ success: true });
});

app.get(`${API_PREFIX}/auth/me`, authRequired, (req, res) => {
  res.json({
    user: {
      id: req.user.sub,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
  });
});

app.post(`${API_PREFIX}/auth/reset-password`, async (req, res) => {
  const email = z.string().email().safeParse(req.body?.email);
  if (!email.success) return res.status(400).json({ message: 'Invalid email' });
  return res.json({ message: 'Password reset link triggered (stub for Supabase Auth).' });
});

app.get(`${API_PREFIX}/products`, authRequired, adminOnly, async (req, res) => {
  const { search = '', category, status, sortBy = 'updatedAt', sortOrder = 'desc', page = '1', pageSize = '10' } = req.query;
  const db = await readDb();

  let items = db.products.filter((p) => !p.isArchived);

  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q),
    );
  }

  if (category) items = items.filter((p) => p.category === category);
  if (status) items = items.filter((p) => p.status === status);

  items = items
    .map((p) => ({ ...p, finalPrice: computeFinalPrice(p.basePrice, p.discount) }))
    .sort((a, b) => {
      const aVal = a[sortBy] ?? '';
      const bVal = b[sortBy] ?? '';
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  const p = Number(page);
  const ps = Number(pageSize);
  const total = items.length;
  const data = items.slice((p - 1) * ps, p * ps);

  res.json({ data, pagination: { page: p, pageSize: ps, total } });
});

app.get(`${API_PREFIX}/products/:id`, authRequired, adminOnly, async (req, res) => {
  const db = await readDb();
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  return res.json({ ...product, finalPrice: computeFinalPrice(product.basePrice, product.discount) });
});

const productCreateSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(2),
  category: z.enum(PRODUCT_CATEGORIES),
  brand: z.string().min(2),
  basePrice: z.number().positive(),
  image: z.string().url().optional(),
  stockQuantity: z.number().int().nonnegative().optional(),
  size: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'OUT_OF_STOCK']).default('ACTIVE'),
});

app.post(`${API_PREFIX}/products`, authRequired, adminOnly, async (req, res) => {
  const parsed = productCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  const now = new Date().toISOString();
  const payload = parsed.data;
  const primaryImage = payload.image || 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80';
  const variantStock = payload.stockQuantity ?? 0;
  const variantSize = payload.size || 'Free';
  const variantColor = payload.color || 'Default';
  const product = {
    id: generateId('p'),
    name: payload.name,
    description: payload.description,
    category: payload.category,
    brand: payload.brand,
    basePrice: payload.basePrice,
    status: payload.status,
    isArchived: false,
    archivedAt: null,
    images: [
      {
        id: generateId('img'),
        url: primaryImage,
        sortOrder: 1,
        isPrimary: true,
      },
    ],
    variants: [
      {
        id: generateId('v'),
        size: variantSize,
        color: variantColor,
        stockQuantity: variantStock,
      },
    ],
    discount: { type: null, value: null, startsAt: null, expiresAt: null, isActive: false, finalPrice: payload.basePrice },
    auditLogs: [
      {
        id: generateId('a'),
        actor: req.user.email,
        action: 'PRODUCT_CREATED',
        changes: payload,
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  await updateDb((draft) => {
    draft.products.push(product);
    return draft;
  });

  res.status(201).json(product);
});

app.patch(`${API_PREFIX}/products/:id`, authRequired, adminOnly, async (req, res) => {
  const patch = z
    .object({
      name: z.string().min(2).optional(),
      description: z.string().min(2).optional(),
      category: z.enum(PRODUCT_CATEGORIES).optional(),
      brand: z.string().min(2).optional(),
      image: z.string().url().optional(),
      basePrice: z.number().positive().optional(),
      stockQuantity: z.number().int().nonnegative().optional(),
      size: z.string().min(1).optional(),
      color: z.string().min(1).optional(),
      status: z.enum(['ACTIVE', 'DRAFT', 'OUT_OF_STOCK']).optional(),
    })
    .safeParse(req.body);

  if (!patch.success) return res.status(400).json({ message: 'Invalid payload' });

  let updatedProduct = null;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;

    if (patch.data.name) product.name = patch.data.name;
    if (patch.data.description) product.description = patch.data.description;
    if (patch.data.category) product.category = patch.data.category;
    if (patch.data.brand) product.brand = patch.data.brand;
    if (patch.data.status) product.status = patch.data.status;
    if (typeof patch.data.basePrice === 'number') product.basePrice = patch.data.basePrice;
    if (patch.data.image) {
      if (!product.images.length) {
        product.images.push({
          id: generateId('img'),
          url: patch.data.image,
          sortOrder: 1,
          isPrimary: true,
        });
      } else {
        product.images[0].url = patch.data.image;
        product.images[0].isPrimary = true;
      }
    }
    if (typeof patch.data.stockQuantity === 'number') {
      if (!product.variants.length) {
        product.variants.push({
          id: generateId('v'),
          size: patch.data.size || 'Free',
          color: patch.data.color || 'Default',
          stockQuantity: patch.data.stockQuantity,
        });
      } else {
        product.variants[0].stockQuantity = patch.data.stockQuantity;
        if (patch.data.size) product.variants[0].size = patch.data.size;
        if (patch.data.color) product.variants[0].color = patch.data.color;
      }
    }

    product.updatedAt = new Date().toISOString();
    product.auditLogs.push({
      id: generateId('a'),
      actor: req.user.email,
      action: 'PRODUCT_UPDATED',
      changes: patch.data,
      createdAt: new Date().toISOString(),
    });

    updatedProduct = product;
    return draft;
  });

  if (!updatedProduct) return res.status(404).json({ message: 'Product not found' });
  res.json(updatedProduct);
});

app.put(`${API_PREFIX}/products/:id`, authRequired, adminOnly, async (req, res) => {
  const parsed = productCreateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  let updated = null;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;

    const patch = parsed.data;
    if (patch.name) product.name = patch.name;
    if (patch.description) product.description = patch.description;
    if (patch.category) product.category = patch.category;
    if (patch.brand) product.brand = patch.brand;
    if (typeof patch.basePrice === 'number') product.basePrice = patch.basePrice;
    if (patch.status) product.status = patch.status;
    if (patch.image) {
      if (!product.images.length) {
        product.images.push({ id: generateId('img'), url: patch.image, sortOrder: 1, isPrimary: true });
      } else {
        product.images[0].url = patch.image;
        product.images[0].isPrimary = true;
      }
    }
    if (typeof patch.stockQuantity === 'number') {
      if (!product.variants.length) {
        product.variants.push({
          id: generateId('v'),
          size: patch.size || 'Free',
          color: patch.color || 'Default',
          stockQuantity: patch.stockQuantity,
        });
      } else {
        product.variants[0].stockQuantity = patch.stockQuantity;
        if (patch.size) product.variants[0].size = patch.size;
        if (patch.color) product.variants[0].color = patch.color;
      }
    }
    product.updatedAt = new Date().toISOString();
    updated = product;
    return draft;
  });

  if (!updated) return res.status(404).json({ message: 'Product not found' });
  res.json(updated);
});

app.patch(`${API_PREFIX}/products/:id/price`, authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({ basePrice: z.number().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid basePrice' });

  let updated = null;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;
    product.basePrice = parsed.data.basePrice;
    if (product.discount?.isActive) {
      product.discount.finalPrice = computeFinalPrice(product.basePrice, product.discount);
    }
    product.updatedAt = new Date().toISOString();
    updated = product;
    return draft;
  });

  if (!updated) return res.status(404).json({ message: 'Product not found' });
  res.json({ ...updated, finalPrice: computeFinalPrice(updated.basePrice, updated.discount) });
});

app.post(`${API_PREFIX}/products/:id/discounts`, authRequired, adminOnly, async (req, res) => {
  const parsed = z
    .object({
      type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
      value: z.number().positive(),
      startsAt: z.string().datetime().nullable().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  let updated = null;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;
    product.discount = {
      ...parsed.data,
      startsAt: parsed.data.startsAt ?? null,
      expiresAt: parsed.data.expiresAt ?? null,
      isActive: true,
      finalPrice: computeFinalPrice(product.basePrice, { ...parsed.data, isActive: true }),
    };
    product.updatedAt = new Date().toISOString();
    updated = product;
    return draft;
  });

  if (!updated) return res.status(404).json({ message: 'Product not found' });
  res.json({ ...updated, finalPrice: computeFinalPrice(updated.basePrice, updated.discount) });
});

app.delete(`${API_PREFIX}/products/:id/discounts/active`, authRequired, adminOnly, async (req, res) => {
  let updated = null;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;
    product.discount = {
      type: null,
      value: null,
      startsAt: null,
      expiresAt: null,
      isActive: false,
      finalPrice: product.basePrice,
    };
    product.updatedAt = new Date().toISOString();
    updated = product;
    return draft;
  });

  if (!updated) return res.status(404).json({ message: 'Product not found' });
  res.json(updated);
});

app.delete(`${API_PREFIX}/products/:id`, authRequired, adminOnly, async (req, res) => {
  let deleted = false;
  await updateDb((draft) => {
    const before = draft.products.length;
    draft.products = draft.products.filter((p) => p.id !== req.params.id);
    deleted = draft.products.length < before;
    return draft;
  });

  if (!deleted) return res.status(404).json({ message: 'Product not found' });
  return res.status(204).send();
});

app.post(`${API_PREFIX}/products/:id/images`, authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({ url: z.string().url() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid URL' });

  let updated = null;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;

    const image = {
      id: generateId('img'),
      url: parsed.data.url,
      sortOrder: product.images.length + 1,
      isPrimary: product.images.length === 0,
    };

    product.images.push(image);
    product.updatedAt = new Date().toISOString();
    updated = product;
    return draft;
  });

  if (!updated) return res.status(404).json({ message: 'Product not found' });
  res.json(updated);
});

app.patch(`${API_PREFIX}/products/:id/images/reorder`, authRequired, adminOnly, async (req, res) => {
  const parsed = z.object({ imageIds: z.array(z.string()).min(1), primaryImageId: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  let updated = null;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;

    const map = new Map(product.images.map((i) => [i.id, i]));
    product.images = parsed.data.imageIds
      .map((id, idx) => ({ ...map.get(id), sortOrder: idx + 1 }))
      .filter(Boolean);

    const primaryId = parsed.data.primaryImageId ?? product.images[0]?.id;
    product.images = product.images.map((img) => ({ ...img, isPrimary: img.id === primaryId }));
    product.updatedAt = new Date().toISOString();
    updated = product;
    return draft;
  });

  if (!updated) return res.status(404).json({ message: 'Product not found' });
  res.json(updated);
});

app.post(`${API_PREFIX}/products/:id/variants`, authRequired, adminOnly, async (req, res) => {
  const parsed = z
    .object({
      size: z.string().min(1),
      color: z.string().min(1),
      stockQuantity: z.number().int().nonnegative(),
    })
    .safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  let variant = null;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;
    variant = { id: generateId('v'), ...parsed.data };
    product.variants.push(variant);
    product.updatedAt = new Date().toISOString();
    return draft;
  });

  if (!variant) return res.status(404).json({ message: 'Product not found' });
  res.status(201).json(variant);
});

app.patch(`${API_PREFIX}/products/:id/variants/:variantId`, authRequired, adminOnly, async (req, res) => {
  const parsed = z
    .object({
      size: z.string().min(1).optional(),
      color: z.string().min(1).optional(),
      stockQuantity: z.number().int().nonnegative().optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  let updated = null;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;
    const variant = product.variants.find((v) => v.id === req.params.variantId);
    if (!variant) return draft;

    Object.assign(variant, parsed.data);
    product.updatedAt = new Date().toISOString();
    updated = variant;
    return draft;
  });

  if (!updated) return res.status(404).json({ message: 'Variant not found' });
  res.json(updated);
});

app.delete(`${API_PREFIX}/products/:id/variants/:variantId`, authRequired, adminOnly, async (req, res) => {
  let removed = false;
  await updateDb((draft) => {
    const product = draft.products.find((p) => p.id === req.params.id);
    if (!product) return draft;
    const len = product.variants.length;
    product.variants = product.variants.filter((v) => v.id !== req.params.variantId);
    removed = product.variants.length < len;
    return draft;
  });

  if (!removed) return res.status(404).json({ message: 'Variant not found' });
  res.status(204).send();
});

app.get(`${API_PREFIX}/orders`, authRequired, adminOnly, async (req, res) => {
  const { status, search = '', dateFrom, dateTo } = req.query;
  const db = await readDb();
  let orders = [...db.orders];

  if (status) orders = orders.filter((o) => o.status === status);
  if (search) {
    const q = String(search).toLowerCase();
    orders = orders.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerEmail.toLowerCase().includes(q),
    );
  }

  if (dateFrom) orders = orders.filter((o) => new Date(o.createdAt) >= new Date(String(dateFrom)));
  if (dateTo) orders = orders.filter((o) => new Date(o.createdAt) <= new Date(String(dateTo)));

  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orders);
});

app.get(`${API_PREFIX}/orders/my`, authRequired, userOnly, async (req, res) => {
  const db = await readDb();
  const mine = db.orders
    .filter((o) => o.userId === req.user.sub)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(mine);
});

const userOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
        selectedSize: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

app.post(`${API_PREFIX}/orders`, authRequired, userOnly, async (req, res) => {
  const parsed = userOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  const db = await readDb();
  const cartItems = parsed.data.items;
  const lineItems = [];
  let totalAmount = 0;

  for (const item of cartItems) {
    const product = db.products.find((p) => p.id === item.productId && p.status === 'ACTIVE');
    if (!product) return res.status(400).json({ message: `Product not available: ${item.productId}` });

    const variant = product.variants.find((v) => (item.selectedSize ? v.size === item.selectedSize : true)) || product.variants[0];
    if (!variant) return res.status(400).json({ message: `No variant available for: ${product.name}` });
    if (variant.stockQuantity < item.quantity) {
      return res.status(400).json({ message: `${product.name} has only ${variant.stockQuantity} in stock` });
    }

    const unitPrice = computeFinalPrice(product.basePrice, product.discount);
    totalAmount += unitPrice * item.quantity;
    lineItems.push({
      productId: product.id,
      productName: product.name,
      variant: `${variant.size} / ${variant.color}`,
      quantity: item.quantity,
      unitPrice,
    });
  }

  const timestamp = new Date().toISOString();
  const orderId = generateId('o');
  const order = {
    id: orderId,
    userId: req.user.sub,
    orderNumber: `GF-${Math.floor(1000 + Math.random() * 9000)}`,
    customerName: req.user.name || 'Customer',
    customerEmail: req.user.email,
    shippingAddress: 'Address not provided',
    status: 'ORDER_PLACED',
    lineItems,
    totalAmount,
    statusHistory: [
      {
        status: 'ORDER_PLACED',
        note: 'Order created by customer',
        changedAt: timestamp,
        changedBy: req.user.email,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await updateDb((draft) => {
    draft.orders.push(order);
    for (const item of cartItems) {
      const product = draft.products.find((p) => p.id === item.productId);
      if (!product) continue;
      const variant = product.variants.find((v) => (item.selectedSize ? v.size === item.selectedSize : true)) || product.variants[0];
      if (!variant) continue;
      variant.stockQuantity = Math.max(0, variant.stockQuantity - item.quantity);
      product.updatedAt = new Date().toISOString();
      if (product.variants.every((v) => v.stockQuantity === 0)) {
        product.status = 'OUT_OF_STOCK';
      }
    }
    return draft;
  });

  return res.status(201).json({ message: 'Order placed', order });
});

app.get(`${API_PREFIX}/orders/:id`, authRequired, adminOnly, async (req, res) => {
  const db = await readDb();
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  return res.json(order);
});

app.patch(`${API_PREFIX}/orders/:id/status`, authRequired, adminOnly, async (req, res) => {
  const parsed = z
    .object({
      status: z.enum(orderFlow),
      note: z.string().max(500).optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ message: 'Invalid payload' });

  let updatedOrder = null;

  await updateDb((draft) => {
    const order = draft.orders.find((o) => o.id === req.params.id);
    if (!order) return draft;

    const currentIndex = orderFlow.indexOf(order.status);
    const nextIndex = orderFlow.indexOf(parsed.data.status);

    if (nextIndex !== currentIndex + 1) {
      return draft;
    }

    order.status = parsed.data.status;
    order.updatedAt = new Date().toISOString();
    order.statusHistory.push({
      status: parsed.data.status,
      note: parsed.data.note ?? '',
      changedAt: new Date().toISOString(),
      changedBy: req.user.email,
    });

    updatedOrder = order;
    return draft;
  });

  if (!updatedOrder) {
    return res.status(400).json({ message: 'Invalid transition or order not found' });
  }

  return res.json({
    ...updatedOrder,
    emailNotification: {
      provider: 'Resend (stub)',
      delivered: true,
      message: `Status update sent to ${updatedOrder.customerEmail}`,
    },
  });
});

app.get(`${API_PREFIX}/dashboard/kpis`, authRequired, adminOnly, async (_req, res) => {
  const db = await readDb();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay() || 7;
  startOfWeek.setDate(startOfWeek.getDate() - day + 1);
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const bySince = (since) => db.orders.filter((o) => new Date(o.createdAt) >= since);

  const todayOrders = bySince(startOfDay);
  const weekOrders = bySince(startOfWeek);
  const monthOrders = bySince(startOfMonth);

  res.json({
    totalOrdersToday: todayOrders.length,
    totalOrdersWeek: weekOrders.length,
    totalOrdersMonth: monthOrders.length,
    totalRevenue: db.orders.reduce((sum, o) => sum + o.totalAmount, 0),
    pendingOrders: db.orders.filter((o) => o.status !== 'DELIVERED').length,
  });
});

app.get(`${API_PREFIX}/dashboard/top-products`, authRequired, adminOnly, async (_req, res) => {
  const db = await readDb();
  const sales = new Map();

  for (const order of db.orders) {
    for (const item of order.lineItems) {
      const current = sales.get(item.productName) ?? 0;
      sales.set(item.productName, current + item.quantity);
    }
  }

  const result = [...sales.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  res.json(result);
});

app.get(`${API_PREFIX}/dashboard/low-stock`, authRequired, adminOnly, async (_req, res) => {
  const db = await readDb();
  const threshold = db.settings.lowStockThreshold ?? 10;
  const low = [];

  for (const p of db.products.filter((item) => !item.isArchived)) {
    for (const v of p.variants) {
      if (v.stockQuantity < threshold) {
        low.push({
          productId: p.id,
          productName: p.name,
          variantId: v.id,
          size: v.size,
          color: v.color,
          stockQuantity: v.stockQuantity,
        });
      }
    }
  }

  res.json({ threshold, items: low });
});

app.get(`${API_PREFIX}/dashboard/orders-by-status`, authRequired, adminOnly, async (_req, res) => {
  const db = await readDb();
  const counts = orderFlow.map((status) => ({
    status,
    count: db.orders.filter((o) => o.status === status).length,
  }));
  res.json(counts);
});

app.get(`${API_PREFIX}/storefront/products`, async (_req, res) => {
  const db = await readDb();
  const items = db.products
    .filter((p) => p.status === 'ACTIVE')
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      image: p.images.find((i) => i.isPrimary)?.url,
      originalPrice: p.basePrice,
      finalPrice: computeFinalPrice(p.basePrice, p.discount),
      stock: p.variants.reduce((sum, v) => sum + v.stockQuantity, 0),
      sizes: p.variants.map((v) => ({ size: v.size, stockQuantity: v.stockQuantity })),
    }));

  res.json(items);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
