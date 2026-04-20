import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabase } from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../data/store.json');

async function migrate() {
  console.log('🚀 Starting migration from JSON to Supabase...');

  try {
    const raw = await fs.readFile(DB_PATH, 'utf-8');
    const db = JSON.parse(raw);

    // 1. Migrate Users
    console.log('👥 Migrating users...');
    for (const user of db.users) {
      const { error } = await supabase.from('users').upsert({
        id: user.id,
        name: user.name,
        email: user.email,
        password_hash: user.passwordHash,
        role: user.role,
        failed_login_attempts: user.failedLoginAttempts,
        locked_until: user.lockedUntil,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      });
      if (error) console.error(`Error migrating user ${user.email}:`, error.message);
    }

    // 2. Migrate Products
    console.log('📦 Migrating products...');
    for (const product of db.products) {
      const { error } = await supabase.from('products').upsert({
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        brand: product.brand,
        base_price: product.basePrice,
        status: product.status,
        is_archived: product.isArchived,
        archived_at: product.archivedAt,
        images: product.images,
        variants: product.variants,
        discount: product.discount,
        audit_logs: product.auditLogs,
        created_at: product.createdAt,
        updated_at: product.updatedAt,
      });
      if (error) console.error(`Error migrating product ${product.id}:`, error.message);
    }

    // 3. Migrate Orders
    console.log('🛒 Migrating orders...');
    for (const order of db.orders) {
      const { error } = await supabase.from('orders').upsert({
        id: order.id,
        user_id: order.userId,
        order_number: order.orderNumber,
        customer_name: order.customerName,
        customer_email: order.customerEmail,
        shipping_address: order.shippingAddress,
        status: order.status,
        line_items: order.lineItems,
        total_amount: order.totalAmount,
        status_history: order.statusHistory,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
      });
      if (error) console.error(`Error migrating order ${order.id}:`, error.message);
    }

    // 4. Migrate Settings
    console.log('⚙️ Migrating settings...');
    for (const [key, value] of Object.entries(db.settings)) {
      const { error } = await supabase.from('settings').upsert({ key, value });
      if (error) console.error(`Error migrating setting ${key}:`, error.message);
    }

    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
  }
}

migrate();
