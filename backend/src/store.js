import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase credentials missing. DB operations will fail.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// --- Helpers to map between DB (snake_case) and JS (camelCase) ---

function mapUserToJS(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    passwordHash: u.password_hash,
    role: u.role,
    failedLoginAttempts: u.failed_login_attempts,
    lockedUntil: u.locked_until,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

function mapUserToDB(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    password_hash: u.passwordHash,
    role: u.role,
    failed_login_attempts: u.failedLoginAttempts,
    locked_until: u.lockedUntil,
    updated_at: new Date().toISOString(),
  };
}

// --- Specific CRUD Functions ---

export async function readDb() {
  // Mocking the old readDb for compatibility where necessary,
  // but we should move to specific functions.
  const [users, products, orders, settings] = await Promise.all([
    supabase.from('users').select('*'),
    supabase.from('products').select('*'),
    supabase.from('orders').select('*'),
    supabase.from('settings').select('*'),
  ]);

  return {
    users: (users.data || []).map(mapUserToJS),
    products: products.data || [],
    orders: orders.data || [],
    settings: (settings.data || []).reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {}),
  };
}

export async function findUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  if (error || !data) return null;
  return mapUserToJS(data);
}

export async function createUser(user) {
  const { data, error } = await supabase
    .from('users')
    .insert([mapUserToDB(user)])
    .select()
    .single();
  if (error) throw error;
  return mapUserToJS(data);
}

export async function updateUser(id, updates) {
  const dbUpdates = {};
  if (updates.name) dbUpdates.name = updates.name;
  if (updates.email) dbUpdates.email = updates.email;
  if (updates.passwordHash) dbUpdates.password_hash = updates.passwordHash;
  if (updates.role) dbUpdates.role = updates.role;
  if (typeof updates.failedLoginAttempts === 'number') dbUpdates.failed_login_attempts = updates.failedLoginAttempts;
  if (updates.lockedUntil !== undefined) dbUpdates.locked_until = updates.lockedUntil;
  dbUpdates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .update(dbUpdates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapUserToJS(data);
}

export async function getProducts(filters = {}) {
  let query = supabase.from('products').select('*').eq('is_archived', false);

  if (filters.category) query = query.eq('category', filters.category);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createProduct(product) {
  const { data, error } = await supabase
    .from('products')
    .insert([product])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, updates) {
  const { data, error } = await supabase
    .from('products')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

export async function createOrder(order) {
  const { data, error } = await supabase
    .from('orders')
    .insert([order])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateOrder(id, updates) {
  const { data, error } = await supabase
    .from('orders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getSettings() {
  const { data, error } = await supabase.from('settings').select('*');
  if (error) throw error;
  return (data || []).reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});
}

export async function updateSettings(key, value) {
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value });
  if (error) throw error;
}

export function generateId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// Compat layer for index.js updateDb - Minimal support for common operations
export async function updateDb(mutator) {
  // This is a high-level helper that will be deprecated once index.js is refactored.
  const db = await readDb();
  // We simulate the mutator on the local copy.
  // Note: This won't actually sync back to Supabase automatically for all cases!
  // We need to refactor index.js to use the specific functions above.
  return await mutator(db);
}
